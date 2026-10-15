import "server-only";
import type Stripe from "stripe";
import type { RepositorySnapshot } from "@/lib/analyzer";
import { hashRequestIp } from "@/lib/access";
import { githubRequest, GitHubApiError, parseGitHubRepoUrl, type GitBlob, type GitTree } from "@/lib/github";
import type { Lang } from "@/lib/i18n";
import { getReport } from "@/lib/reports";
import type { StoredReport } from "@/types/report";
import { signingSecret } from "@/lib/session-token";
import { stripeClient } from "@/lib/stripe";
import { MAX_PATCH_SOURCE_BYTES, PatchError } from "@/lib/patch/case-patch";
import { PATCH_AMOUNT, PATCH_CURRENCY, patchCheckoutParams, stripeLookupFailure, validatePatchPayment } from "@/lib/patch/payments";
import { planCasePatch, type PlannedFix, type SkippedFix } from "@/lib/patch/plan";
import { openQuote, PATCH_APP, sealQuote, tokenHash } from "@/lib/patch/quote";

export type PatchOffer =
  | { eligible: true; fixes: PlannedFix[]; skipped: SkippedFix[]; files: string[]; commitSha: string; amountMinor: number;
      currency: string; quoteToken: string; expiresAt: string }
  | { eligible: false; reason: "no-imports" | "private" | "nothing" | "truncated"; skipped: SkippedFix[] };

/** Files read per offer: the ones the report flagged, capped so one check stays a handful of GitHub calls. */
const MAX_FILES = 12;
const buckets = new Map<string, { start: number; count: number }>();

/** Best-effort burst limit per visitor and server instance; the GitHub calls are the only cost. */
function allowPrepare(request: Request): boolean {
  const now = Date.now();
  for (const [id, bucket] of buckets) if (now - bucket.start > 60_000) buckets.delete(id);
  if (buckets.size > 2000) return false;
  const id = hashRequestIp(request);
  const bucket = buckets.get(id) ?? { start: now, count: 0 };
  bucket.count += 1;
  buckets.set(id, bucket);
  return bucket.count <= 6;
}

/**
 * Checks whether a saved report's import failures can be fixed by a verified automatic patch. Reads the
 * repository's current default branch, not the report's old copy, so the patch always fits the latest commit.
 */
export async function preparePatch(request: Request, reportId: string): Promise<PatchOffer> {
  const report = await getReport(reportId);
  if (!report) throw new PatchError("Report not found.", 404, "report");
  return preparePatchForReport(request, report);
}

export async function preparePatchForReport(request: Request, report: StoredReport): Promise<PatchOffer> {
  const secret = signingSecret();
  if (report.is_private) return { eligible: false, reason: "private", skipped: [] };
  const imports = report.results.checks.find((check) => check.id === "imports");
  const flagged = [...new Set((imports?.status === "red" ? imports.findings ?? [] : []).map((finding) => finding.file))];
  if (!flagged.length) return { eligible: false, reason: "no-imports", skipped: [] };
  if (!allowPrepare(request)) throw new PatchError("Too many checks in a short time. Wait a minute and try again.", 429, "delivery");

  const { owner, name, canonicalUrl } = parseGitHubRepoUrl(report.repo_url);
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const token = process.env.GITHUB_TOKEN;
  const repository = await githubRequest<{ default_branch: string; private: boolean }>(repoPath, token);
  if (repository.private) return { eligible: false, reason: "private", skipped: [] };
  const branch = repository.default_branch.split("/").map(encodeURIComponent).join("/");
  const ref = await githubRequest<{ object: { sha: string } }>(`${repoPath}/git/ref/heads/${branch}`, token);
  const commitSha = ref.object.sha;
  if (!/^[a-f0-9]{40}$/.test(commitSha)) throw new GitHubApiError("Unexpected branch reference.", 502);
  const tree = await githubRequest<GitTree>(`${repoPath}/git/trees/${commitSha}?recursive=1`, token);
  if (tree.truncated) return { eligible: false, reason: "truncated", skipped: [] };

  // The flagged files, plus the TypeScript config the analyzer uses to resolve `@/` aliases.
  const wanted = new Set([...flagged.slice(0, MAX_FILES), "tsconfig.json", "jsconfig.json"]);
  const blobs = tree.tree.filter((entry) => entry.type === "blob" && wanted.has(entry.path) && (entry.size ?? 0) <= MAX_PATCH_SOURCE_BYTES);
  const contents = new Map<string, string>();
  await Promise.all(blobs.map(async (entry) => {
    const blob = await githubRequest<GitBlob>(`${repoPath}/git/blobs/${entry.sha}`, token);
    if (blob.encoding === "base64") contents.set(entry.path, Buffer.from(blob.content.replace(/\n/g, ""), "base64").toString("utf8"));
  }));

  const entries = tree.tree.filter((entry): entry is typeof entry & { type: "blob" | "tree" } => entry.type === "blob" || entry.type === "tree")
    .map(({ path, type, size }) => ({ path, type, size }));
  const snapshot: RepositorySnapshot = { owner, name, defaultBranch: repository.default_branch, entries, contents,
    sourceFilesFound: contents.size, sourceFilesRead: contents.size, partial: false };
  const plan = planCasePatch(snapshot);
  if (!plan.fixes.length) return { eligible: false, reason: "nothing", skipped: plan.skipped };

  const { token: quoteToken, quote } = sealQuote({ reportId: report.id, repoUrl: canonicalUrl, commitSha, files: plan.files,
    fixes: plan.fixes.length, patch: plan.patch }, secret);
  return { eligible: true, fixes: plan.fixes, skipped: plan.skipped, files: plan.files, commitSha,
    amountMinor: PATCH_AMOUNT, currency: PATCH_CURRENCY, quoteToken, expiresAt: new Date(quote.expiresAt * 1000).toISOString() };
}

/** Starts a one-time Stripe Checkout for a prepared quote. The same quote always reuses the same session. */
export async function createPatchCheckout(quoteToken: string, origin: string, lang: Lang) {
  const secret = signingSecret();
  const quote = openQuote(quoteToken, secret);
  const session = await stripeClient().checkout.sessions.create(patchCheckoutParams(quoteToken, secret, origin, lang),
    { idempotencyKey: `${PATCH_APP}-${lang}-${tokenHash(quoteToken)}` });
  if (!session.url || session.status === "expired") throw new PatchError("Checkout could not be opened. Check the repository again.", 409, "expired");
  return { url: session.url, accessKey: quote.accessKey };
}

const SESSION_ID = /^cs_(?:live|test)_[A-Za-z0-9]{10,200}$/;

/**
 * Returns the paid patch, after Stripe itself confirms the payment and the browser proves it holds the
 * access key. The cookie keeps the last few keys, so a second purchase does not lock out the first.
 */
export async function retrievePaidPatch(sessionId: string, accessKeys: string[]) {
  if (!SESSION_ID.test(sessionId)) throw new PatchError("Unknown order.", 404, "payment");
  let session: Stripe.Checkout.Session;
  try {
    session = await stripeClient().checkout.sessions.retrieve(sessionId, { expand: ["payment_intent.latest_charge"] });
  } catch (error) {
    throw stripeLookupFailure(error);
  }
  const accessKey = accessKeys.find((key) => tokenHash(key) === session.metadata?.access_hash) ?? "";
  const quote = validatePatchPayment(session, signingSecret(), accessKey);
  return { repoUrl: quote.repoUrl, commitSha: quote.commitSha, files: quote.files, fixes: quote.fixes, patch: quote.patch, reportId: quote.reportId };
}
