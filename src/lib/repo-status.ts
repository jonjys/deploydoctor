import type { StoredReport } from "@/types/report";
import { BADGE_COLORS } from "@/lib/report-badge";
import { neutralReport } from "@/lib/report-summary";

export const STATUS_MAX_AGE_MS = 7 * 86400_000;

/** These are path segments, never a URL or a PostgREST expression. */
export function statusRepository(owner: string, name: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,38}$/i.test(owner) || !/^[a-z0-9_.-]{1,100}$/i.test(name) || /^\.{1,2}$/.test(name)) return null;
  return { owner, name, url: `https://github.com/${owner}/${name}` };
}

/** Escape LIKE wildcards: acme/my_app must never match acme/myXapp. */
export function statusFilter(owner: string, name: string) {
  const repo = statusRepository(owner, name);
  if (!repo) return null;
  return { repo_url: `ilike.${repo.url.replace(/[\\%_*]/g, "\\$&")}`, "results->repository->>ref": "is.null",
    select: "id,repo_url,results,created_at", order: "created_at.desc,id.desc", limit: "1" };
}

/** A scan is evidence about a commit, never a promise about the live deployment. */
export function repoStatus(report: StoredReport | null, now = Date.now()) {
  if (!report || report.is_private) return { label: "not scanned", color: BADGE_COLORS.neutral, date: null, commit: null, stale: false };
  const { results } = report;
  const time = Date.parse(report.created_at);
  const validTime = Number.isFinite(time) && time <= now + 60_000;
  const stale = !validTime || now - time > STATUS_MAX_AGE_MS;
  const date = validTime ? new Date(time).toISOString().slice(0, 10) : null;
  const commit = /^[a-f0-9]{40}$/.test(results.repository.commitSha ?? "") ? results.repository.commitSha!.slice(0, 7) : null;
  const restricted = results.scope && (results.scope.ignored.length > 0 || results.scope.scanned.length === 0);
  if (results.scan.partial) return { label: "partial scan", color: BADGE_COLORS.neutral, date, commit, stale };
  if (stale) return { label: "scan out of date", color: BADGE_COLORS.neutral, date, commit, stale };
  if (!commit) return { label: "rescan needed", color: BADGE_COLORS.neutral, date, commit, stale };
  if (neutralReport(results) || results.checks.length === 0) return { label: "needs review", color: BADGE_COLORS.neutral, date, commit, stale };
  // Count the actual checks, not a headline saved by an older analyzer.
  const red = results.checks.filter(check => check.status === "red").length;
  const yellow = results.checks.filter(check => check.status === "yellow").length;
  const label = red ? `${red} issue${red === 1 ? "" : "s"}` : yellow ? `${yellow} to review` : restricted ? "selected checks passed" : "checks passed";
  return { label, color: red ? BADGE_COLORS.red : yellow ? BADGE_COLORS.yellow : restricted ? BADGE_COLORS.neutral : BADGE_COLORS.green, date, commit, stale };
}

export function liveBadgeMarkdown(owner: string, name: string, site: string) {
  return `[![DeployDoctor repo status](${site}/badge/${encodeURIComponent(owner)}/${encodeURIComponent(name)}.svg)](${site}/score/${encodeURIComponent(owner)}/${encodeURIComponent(name)})`;
}
