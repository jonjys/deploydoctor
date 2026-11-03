import { z } from "zod";
import { boundedBody } from "@/lib/bounded-body";
import { GitHubApiError } from "@/lib/github";
import { langFromRequest, t } from "@/lib/i18n";
import { resolveFixToken } from "@/lib/fix-pr/fulfill";
import { prepareRepositoryFix } from "@/lib/fix-pr/prepare";
import { FIX_AMOUNT, FIX_CURRENCY, FIX_PROMO_CAP } from "@/lib/fix-pr/constants";
import { parseFixTarget } from "@/lib/fix-pr/target";
import { promoRemaining } from "@/lib/fix-pr/store";
import { sameOrigin } from "@/lib/stripe";
import { fixPullRequestsEnabled } from "@/lib/fix-pr/github-app";

export const runtime = "nodejs";
export const maxDuration = 60;
const noStore = { "Cache-Control": "no-store" };

/** Free diagnosis. The sealed quote is opaque; the patch diff is not in this response. */
export async function POST(request: Request) {
  const lang = langFromRequest(request);
  if (!sameOrigin(request)) return Response.json({ error: t(lang, "err.origin") }, { status: 403, headers: noStore });
  try {
    const parsed = z.object({ target: z.string().min(3).max(20_000) }).safeParse(JSON.parse(await boundedBody(request, 24_000)));
    if (!parsed.success) return Response.json({ error: "Paste a GitHub repository URL or a Vercel build log." }, { status: 400, headers: noStore });
    const target = parseFixTarget(parsed.data.target);
    if (!target) return Response.json({ error: "Paste a github.com repository URL, owner/repo, or the Vercel build log." }, { status: 400, headers: noStore });
    if (target.kind === "needs-repo") {
      return Response.json({ needsRepo: true, liveUrl: target.liveUrl, diagnosisFree: true,
        message: "That is a live Vercel URL. Paste the GitHub repository, or the build log, so the diagnosis can see the code." }, { headers: noStore });
    }
    let token: string | undefined;
    try { token = (await resolveFixToken()) ?? undefined; } catch { token = undefined; }
    const prepared = await prepareRepositoryFix(target.repo, token);
    // Without a configured Fix GitHub App nothing can be delivered, so nothing is offered: diagnosis only.
    const enabled = fixPullRequestsEnabled();
    const remaining = enabled ? await promoRemaining() : null;
    return Response.json({
      diagnosisFree: true, needsRepo: false, eligible: enabled && prepared.eligible, fixAvailable: enabled, isPrivate: prepared.isPrivate,
      repoUrl: prepared.repoUrl, headline: prepared.headline, items: prepared.items, fixes: enabled ? prepared.fixes : [],
      commitSha: prepared.commitSha ?? null, quoteToken: enabled ? prepared.quoteToken ?? null : null,
      amountMinor: FIX_AMOUNT, currency: FIX_CURRENCY, promoRemaining: remaining, promoCap: FIX_PROMO_CAP,
    }, { headers: noStore });
  } catch (error) {
    if (error instanceof GitHubApiError) return Response.json({ error: error.localized(lang) }, { status: error.status, headers: noStore });
    if (error instanceof SyntaxError) return Response.json({ error: t(lang, "err.invalidJson") }, { status: 400, headers: noStore });
    console.error("Fix diagnosis failed");
    return Response.json({ error: "The repository could not be diagnosed right now. Nothing was charged." }, { status: 502, headers: noStore });
  }
}
