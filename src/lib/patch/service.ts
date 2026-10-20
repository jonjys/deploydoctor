import "server-only";
import type Stripe from "stripe";
import { acquireWork, releaseWork } from "@/lib/work-budget";
import { patchRules } from "@/lib/budget-policy";
import type { RepositorySnapshot } from "@/lib/analyzer";
import { hashRequestIp } from "@/lib/access";
import { githubRequest, parseGitHubRepoUrl, type GitBlob, type GitTree } from "@/lib/github";
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
      currency: string; quoteToken: string; recoveryKey: string; expiresAt: string }
  | { eligible: false; reason: "no-imports" | "private" | "nothing" | "truncated" | "version"; skipped: SkippedFix[] };

/** Files read per offer: the ones the report flagged, capped so one check stays a handful of GitHub calls. */
const MAX_FILES = 12;
/**
 * Checks whether a saved report's import failures can be fixed by a verified automatic patch. Reads the
 * immutable commit recorded in the report. Older unpinned reports must be scanned again.
 */
export async function preparePatch(request: Request, reportId: string): Promise<PatchOffer> {
  const report = await getReport(reportId);
  if (!report) throw new PatchError("Report not found.", 404, "report");
  return preparePatchForReport(request, report);
}

export async function preparePatchForReport(request: Request, report: StoredReport): Promise<PatchOffer> {
  const secret = signingSecret();
  await acquireWork(patchRules(hashRequestIp(request), "prepare"));
  const lease = await acquireWork([], "patch-prepare", 3, 50);
  try { return await preparePinnedReport(report, secret); }
  finally { if (lease) await releaseWork(lease); }
}

async function preparePinnedReport(report: StoredReport, secret: string): Promise<PatchOffer> {
  if (report.is_private) return { eligible: false, reason: "private", skipped: [] };
  const imports = report.results.checks.find((check) => check.id === "imports");
  const flagged = [...new Set((imports?.status === "red" ? imports.findings ?? [] : []).map((finding) => finding.file))];
  if (!flagged.length) return { eligible: false, reason: "no-imports", skipped: [] };
  const commitSha = report.results.repository.commitSha;
  if (!commitSha || !/^[a-f0-9]{40}$/.test(commitSha)) return { eligible: false, reason: "version", skipped: [] };

  const { owner, name, canonicalUrl } = parseGitHubRepoUrl(report.repo_url);
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const token = process.env.GITHUB_TOKEN;
  const repository = await githubRequest<{ default_branch: string; private: boolean }>(repoPath, token);
  if (repository.private) return { eligible: false, reason: "private", skipped: [] };
  const tree = await githubRequest<GitTree>(`${repoPath}/git/trees/${commitSha}?recursive=1`, token);
  if (tree.truncated || tree.tree.length > 30_000) return { eligible: false, reason: "truncated", skipped: [] };

  // The flagged files, plus every TypeScript config the analyzer uses to resolve `@/` aliases (a nested app has its own).
  const configs = tree.tree.filter((entry) => entry.type === "blob" && /(?:^|\/)(?:tsconfig|jsconfig)\.json$/.test(entry.path)).map((entry) => entry.path);
  const wanted = new Set([...flagged.slice(0, MAX_FILES), ...configs, "package.json", ".gitignore"]);
  const blobs = tree.tree.filter((entry) => entry.type === "blob" && entry.mode !== "120000" && wanted.has(entry.path) && (entry.size ?? 0) <= MAX_PATCH_SOURCE_BYTES);
  const contents = new Map<string, string>();
  await Promise.all(blobs.map(async (entry) => {
    const blob = await githubRequest<GitBlob>(`${repoPath}/git/blobs/${entry.sha}`, token);
    if (blob.encoding !== "base64") return;
    const bytes = Buffer.from(blob.content.replace(/\n/g, ""), "base64");
    const source = bytes.toString("utf8");
    if (bytes.length <= MAX_PATCH_SOURCE_BYTES && !source.includes("\uFFFD")) contents.set(entry.path, source);
  }));

  const entries = tree.tree.filter((entry): entry is typeof entry & { type: "blob" | "tree" } => (entry.type === "blob" && entry.mode !== "120000") || entry.type === "tree")
    .map(({ path, type, size }) => ({ path, type, size }));
  const snapshot: RepositorySnapshot = { owner, name, defaultBranch: repository.default_branch, entries, contents,
    sourceFilesFound: contents.size, sourceFilesRead: contents.size, partial: false };
  const plan = planCasePatch(snapshot);
  if (!plan.fixes.length) return { eligible: false, reason: "nothing", skipped: plan.skipped };

  const { token: quoteToken, quote } = sealQuote({ reportId: report.id, repoUrl: canonicalUrl, commitSha, files: plan.files,
    fixes: plan.fixes.length, patch: plan.patch, sourceHashes: plan.sourceHashes }, secret);
  return { eligible: true, fixes: plan.fixes, skipped: plan.skipped, files: plan.files, commitSha,
    amountMinor: PATCH_AMOUNT, currency: PATCH_CURRENCY, quoteToken, recoveryKey: quote.accessKey, expiresAt: new Date(quote.expiresAt * 1000).toISOString() };
}

/** Starts a one-time Stripe Checkout for a prepared quote. The same quote always reuses the same session. */
export async function createPatchCheckout(quoteToken: string, origin: string, lang: Lang, accessKeys: string[]) {
  const secret = signingSecret();
  const quote = openQuote(quoteToken, secret);
  if (!accessKeys.includes(quote.accessKey)) throw new PatchError("This offer belongs to another browser.", 403, "access");
  const session = await stripeClient().checkout.sessions.create(patchCheckoutParams(quoteToken, secret, origin, lang),
    { idempotencyKey: `${PATCH_APP}-${tokenHash(quoteToken)}` });
  if (!session.url || session.status === "expired") throw new PatchError("Checkout could not be opened. Check the repository again.", 409, "expired");
  return { url: session.url, accessKey: quote.accessKey };
}

const SESSION_ID = /^cs_(?:live|test)_[A-Za-z0-9]{10,200}$/;

/**
 * Returns the paid patch, after Stripe itself confirms the payment and the browser proves it holds the
 * access key. The cookie keeps the last few keys, so a second purchase does not lock out the first.
 */
type DeliveryDependencies = {
  loadSession: (id: string) => Promise<Stripe.Checkout.Session>;
  reserve: typeof acquireWork;
  secret: string;
  live: boolean;
};
export async function retrievePaidPatch(sessionId: string, accessKeys: string[], dependencies?: DeliveryDependencies) {
  if (!accessKeys.some(key => /^[a-f0-9]{64}$/.test(key))) throw new PatchError("Use your recovery key to restore this purchase.", 403, "access");
  await (dependencies?.reserve ?? acquireWork)(patchRules(tokenHash(accessKeys[0]), "delivery"));
  if (!SESSION_ID.test(sessionId)) throw new PatchError("Unknown order.", 404, "payment");
  let session: Stripe.Checkout.Session;
  try {
    session = await (dependencies?.loadSession ? dependencies.loadSession(sessionId)
      : stripeClient().checkout.sessions.retrieve(sessionId, { expand: ["payment_intent.latest_charge"] }));
    if (session.id !== sessionId) throw new PatchError("Payment session mismatch.", 403, "payment");
  } catch (error) {
    if (error instanceof PatchError) throw error;
    throw stripeLookupFailure(error);
  }
  const accessKey = accessKeys.find((key) => tokenHash(key) === session.metadata?.access_hash) ?? "";
  const quote = validatePatchPayment(session, dependencies?.secret ?? signingSecret(), accessKey, dependencies?.live ?? /^(?:sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? ""));
  return { repoUrl: quote.repoUrl, commitSha: quote.commitSha, files: quote.files, fixes: quote.fixes, patch: quote.patch, reportId: quote.reportId, sourceHashes: quote.sourceHashes, accessHash: tokenHash(accessKey) };
}
