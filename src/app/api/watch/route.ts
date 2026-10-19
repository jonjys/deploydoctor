import { mailRules } from "@/lib/budget-policy";
import { acquireWork, workLimitResponse } from "@/lib/work-budget";
import { hashRequestIp } from "@/lib/access";
import { rpc } from "@/lib/db";
import { GitHubApiError, githubRequest, parseGitHubRepoUrl } from "@/lib/github";
import { langFromRequest, t, type Lang } from "@/lib/i18n";
import { getReport } from "@/lib/reports";
import { appOrigin } from "@/lib/site";
import { sameOrigin } from "@/lib/stripe";
import { confirmationEmail, newWatchToken, normalizeEmail, reportLang, sendWatchEmail, unsubscribeToken, watchConfig } from "@/lib/watch";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Watch this repo, step one: same-origin JSON { reportId or repoUrl, email }. Stores an unconfirmed watch and sends
 * the confirmation email; the daily job ignores the watch until the link in it is clicked. Public repositories only.
 * The answer is the same whether or not the address already watches the repository, so it reveals nothing.
 */
export async function POST(request: Request) {
  const lang = langFromRequest(request);
  if (!watchConfig()) return Response.json({ error: t(lang, "watch.unavailable") }, { status: 503 });
  if (!sameOrigin(request)) return Response.json({ error: t(lang, "err.origin") }, { status: 403 });
  try {
    const raw = await request.text();
    if (raw.length > 1_000) return Response.json({ error: t(lang, "err.tooLarge") }, { status: 413 });
    const body = JSON.parse(raw) as { reportId?: unknown; repoUrl?: unknown; email?: unknown };
    const email = normalizeEmail(body.email);
    if (!email) return Response.json({ error: t(lang, "watch.badEmail") }, { status: 400 });

    let repoUrl: string;
    let reportId: string | null = null;
    let mailLang: Lang = "en";
    if (typeof body.reportId === "string") {
      if (!UUID.test(body.reportId)) return Response.json({ error: t(lang, "watch.badTarget") }, { status: 400 });
      const report = await getReport(body.reportId);
      if (!report || report.is_private) return Response.json({ error: t(lang, "watch.badTarget") }, { status: 404 });
      repoUrl = report.repo_url;
      reportId = report.id;
      mailLang = reportLang(report.results) ?? "en";
    } else if (typeof body.repoUrl === "string" && body.repoUrl.length <= 300) {
      const { owner, name } = parseGitHubRepoUrl(body.repoUrl);
      const repo = await githubRequest<{ private: boolean; full_name: string }>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, process.env.GITHUB_TOKEN);
      if (repo.private) return Response.json({ error: t(lang, "watch.badTarget") }, { status: 400 });
      repoUrl = `https://github.com/${repo.full_name}`;
    } else {
      return Response.json({ error: t(lang, "watch.badTarget") }, { status: 400 });
    }

    // Retain this lease for the full cooldown, including across fixed quota window boundaries.
    await acquireWork(mailRules(email), `mail:${email}`, 1, 900);
    const { token, hash } = newWatchToken();
    const result = await rpc<{ status: "created" | "pending" | "confirmed" | "ip_limit" | "email_limit"; id?: string }>("request_repo_watch", {
      p_ip_hash: hashRequestIp(request), p_email: email, p_repo_url: repoUrl, p_token_hash: hash, p_report_id: reportId,
    });
    if (result.status === "ip_limit") return Response.json({ error: t(lang, "watch.limitIp") }, { status: 429 });
    if (result.status === "email_limit") return Response.json({ error: t(lang, "watch.limitEmail") }, { status: 429 });
    if ((result.status === "created" || result.status === "pending") && result.id) {
      const origin = appOrigin(request);
      const sent = await sendWatchEmail(confirmationEmail({
        lang: mailLang, to: email, repo: repoUrl.replace(/^https:\/\/github\.com\//, ""),
        confirmUrl: `${origin}/api/watch/confirm?token=${token}`,
        unsubscribeUrl: `${origin}/api/watch/unsubscribe?token=${unsubscribeToken(result.id)}`,
      }));
      if (!sent) return Response.json({ error: t(lang, "watch.failed") }, { status: 502 });
    }
    console.log("dd-funnel", JSON.stringify({ step: "watch_request", status: result.status }));
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const limited = workLimitResponse(error, lang);
    if (limited) return limited;
    if (error instanceof SyntaxError) return Response.json({ error: t(lang, "err.invalidJson") }, { status: 400 });
    if (error instanceof GitHubApiError) return Response.json({ error: error.localized(lang) }, { status: error.status });
    console.error("Watch request failed:", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: t(lang, "watch.failed") }, { status: 502 });
  }
}
