import type Stripe from "stripe";
import { PatchError } from "@/lib/patch/case-patch";
import { openQuote, tokenHash, type PatchQuote } from "@/lib/patch/quote";
import { openPatchPullRequest, type GitRequest, type PrOrder, type PullRequestText } from "@/lib/patch/pull-request";
import { validateFixPayment } from "@/lib/fix-pr/payments";
import { openPromoReceipt } from "@/lib/fix-pr/promo";

export function quoteToOrder(quote: PatchQuote): PrOrder {
  return { repoUrl: quote.repoUrl, commitSha: quote.commitSha, patch: quote.patch, files: quote.files, sourceHashes: quote.sourceHashes, reportId: quote.reportId };
}

export function fixPullRequestText(branchKey: string, order: PrOrder, summary: string): PullRequestText {
  return {
    branch: `deploydoctor/fix-${branchKey}`,
    commitMessage: "fix: repair the failed deploy",
    title: "Fix the failed deploy",
    draft: false,
    allowPrivate: true,
    body: `## DeployDoctor fix\n\n${summary.slice(0, 500)}\n\nThis pull request changes ${order.files.length} file(s) on commit ${order.commitSha}. The patch was checked against that commit. Repository code was not executed.\n\nNo fix, no pay: if this pull request does not make the build pass, the $5 charge is refunded. Review the diff before you merge. Opening the pull request does not guarantee a successful deployment.\n`,
  };
}

/** The patch diff, only after the same payment or promo gate as the pull request. */
export function readGatedFixPatch(input: {
  session: Stripe.Checkout.Session | null; promoReceipt: string | null; quoteToken: string; secret: string; live?: boolean;
}): { patch: string; files: string[] } {
  const quote = authorizeFix(input);
  return { patch: quote.patch, files: quote.files };
}

function authorizeFix(input: {
  session: Stripe.Checkout.Session | null; promoReceipt: string | null; quoteToken: string; secret: string; live?: boolean;
}): PatchQuote {
  if (input.promoReceipt) {
    if (!input.quoteToken) throw new PatchError("This free fix does not match the diagnosis.", 403, "payment");
    openPromoReceipt(input.promoReceipt, input.quoteToken, input.secret);
    return openQuote(input.quoteToken, input.secret, false);
  }
  if (input.session) {
    const quote = validateFixPayment(input.session, input.secret, input.live);
    if (input.quoteToken && tokenHash(input.quoteToken) !== (input.session.metadata?.quote_hash ?? ""))
      throw new PatchError("This payment does not match the diagnosis.", 403, "payment");
    return quote;
  }
  throw new PatchError("Pay for this fix before the pull request is opened.", 402, "payment");
}

/**
 * Opens the pull request only after a paid Checkout Session or a signed launch-promo receipt.
 * An unpaid session throws before any GitHub call.
 */
export async function openGatedFixPullRequest(input: {
  session: Stripe.Checkout.Session | null;
  promoReceipt: string | null;
  quoteToken: string;
  secret: string;
  live?: boolean;
  summary: string;
  api: GitRequest;
}): Promise<{ url: string; reused: boolean; state: string; draft: boolean; paid: boolean; headSha: string | null; isPrivate: boolean }> {
  const quote = authorizeFix(input);
  const paid = !input.promoReceipt;
  const order = quoteToOrder(quote);
  const branchKey = tokenHash(input.session?.id ?? input.promoReceipt ?? input.quoteToken).slice(0, 24);
  const opened = await openPatchPullRequest(order, branchKey, input.api, fixPullRequestText(branchKey, order, input.summary));
  return { ...opened, paid };
}
