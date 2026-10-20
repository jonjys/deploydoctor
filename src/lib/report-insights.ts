import type { CheckId, CheckResult, CheckStatus, Finding, ReportResults, StoredReport } from "@/types/report";
import { analysisText } from "@/lib/analysis-text";
import { LANGS } from "@/lib/i18n";

/** What a failed check means for the deploy, so a report can be read in three seconds. */
export const severityOf: Record<CheckId, "build" | "runtime" | "security"> = {
  "next-entry": "build", imports: "build", dependencies: "build", "build-config": "build",
  env: "runtime", "server-libs": "runtime", supabase: "runtime", prisma: "runtime",
  secrets: "security",
};

const STATUS_RANK: Record<CheckStatus, number> = { red: 0, yellow: 1, green: 2 };
const SEVERITY_RANK = { build: 0, runtime: 1, security: 2 } as const;

export type FixFirstItem = {
  checkId: CheckId;
  title: string;
  status: "red" | "yellow";
  /** Absent when the check has no per-line findings, as on older reports. */
  file?: string;
  line?: number;
  /** The one line of what to do. Absent on the complete-file item, which the page words itself. */
  fix?: string;
  command?: string;
  /** The complete file the check suggests; it stands in for every finding that only adds a line to it. */
  completeFile?: string;
};

/** The fix texts of a check that is yellow only because the scan did not finish: they say to scan again, not what to change. */
const PARTIAL_FIXES = new Set(LANGS.flatMap((lang) => [analysisText(lang).partialFixToken, analysisText(lang).partialFixRetry]));

/** A check that found nothing and is yellow only because the scan was partial. Its fix is about the scan, not about the code. */
export function isPartialPlaceholder(check: CheckResult): boolean {
  return check.status === "yellow" && !check.findings?.length && PARTIAL_FIXES.has(check.fix);
}

/**
 * Every open item in the order to fix it: red before yellow, then build, runtime and security, then report order.
 * Partial-scan placeholders are left out: they have nothing to fix, and the partial notice already says the scan did not finish.
 */
export function fixFirstItems(checks: CheckResult[]): FixFirstItem[] {
  const open = checks.map((check, index) => ({ check, index })).filter(({ check }) => check.status !== "green" && !isPartialPlaceholder(check));
  open.sort((a, b) => STATUS_RANK[a.check.status] - STATUS_RANK[b.check.status]
    || SEVERITY_RANK[severityOf[a.check.id] ?? "runtime"] - SEVERITY_RANK[severityOf[b.check.id] ?? "runtime"]
    || a.index - b.index);
  return open.flatMap(({ check }): FixFirstItem[] => {
    const base = { checkId: check.id, title: check.title, status: check.status as "red" | "yellow" };
    if (!check.findings?.length) return [{ ...base, fix: check.fix, ...(check.suggestedFile?.command ? { command: check.suggestedFile.command } : {}) }];
    const file = check.suggestedFile;
    const items: FixFirstItem[] = [];
    let fileShown = false;
    for (const finding of check.findings) {
      if (file?.command && finding.command === file.command) {
        if (!fileShown) items.push({ ...base, file: file.path, command: file.command, completeFile: file.path });
        fileShown = true;
        continue;
      }
      items.push({ ...base, file: finding.file, line: finding.line, fix: finding.fix, ...(finding.command ? { command: finding.command } : {}) });
    }
    return items;
  });
}

/** Notes that speak of next dev, NEXT_PUBLIC_ or the app folder, which only hold for a Next.js app at the repository root. */
const NEXT_ONLY_WHY = new Set<CheckId>(["next-entry", "env"]);

/**
 * Failing cards explain why they work locally; a card that is yellow only because the scan was partial found nothing to explain,
 * and a note about Next.js is left off a report of another stack. Older reports have no nextApp and keep every note.
 */
export function showsLocalWhy(check: CheckResult, nextApp?: ReportResults["nextApp"]): boolean {
  if ((nextApp === "none" || nextApp === "nested") && NEXT_ONLY_WHY.has(check.id)) return false;
  return check.id in severityOf && (check.status === "red" || (check.status === "yellow" && !!check.findings?.length));
}

export type ChangedFinding = { checkId: CheckId; title: string; file: string; line: number; problem: string };
export type StatusChange = { checkId: CheckId; title: string; from: CheckStatus; to: CheckStatus };
export type ReportDiff = {
  fixed: ChangedFinding[];
  added: ChangedFinding[];
  statusChanges: StatusChange[];
  /** Checks whose findings could not be compared (another language, or a report from before findings), so only their status was. */
  statusOnly: CheckId[];
  /** One of the scans did not read every file, so a finding can come or go with what was read. */
  partial: boolean;
  /** How many checks ran in both scans. With none there is nothing to compare, so the section is hidden. */
  compared: number;
  /** Checks only one of the scans ran (the chosen categories, a CI scan or the detected stack differed), so they are not compared. */
  notCompared: { checkId: CheckId; title: string }[];
};

/** Findings of a passing check are not open, whatever the check carries. */
function openFindings(check: CheckResult): Finding[] {
  return check.status === "green" ? [] : check.findings ?? [];
}

/** The findings of `from` that `to` does not have, matched by file and problem text; lines move when code is edited. */
function missingFrom(from: Finding[], to: Finding[]): Finding[] {
  const key = (finding: Finding) => `${finding.file}\u0000${finding.problem}`;
  const left = new Map<string, number>();
  for (const finding of to) left.set(key(finding), (left.get(key(finding)) ?? 0) + 1);
  return from.filter((finding) => {
    const count = left.get(key(finding)) ?? 0;
    if (count) left.set(key(finding), count - 1);
    return count === 0;
  });
}

/** What changed between two scans of the same repository. Checks only one of them ran are listed in notCompared. */
export function diffReports(previous: ReportResults, current: ReportResults): ReportDiff {
  const before = new Map(previous.checks.map((check) => [check.id, check]));
  const now = new Set(current.checks.map((check) => check.id));
  const diff: ReportDiff = { fixed: [], added: [], statusChanges: [], statusOnly: [], partial: previous.scan.partial || current.scan.partial,
    compared: 0, notCompared: previous.checks.filter((check) => !now.has(check.id)).map(({ id, title }) => ({ checkId: id, title })) };
  for (const check of current.checks) {
    const old = before.get(check.id);
    if (!old) {
      diff.notCompared.push({ checkId: check.id, title: check.title });
      continue;
    }
    diff.compared++;
    if (old.status !== check.status) diff.statusChanges.push({ checkId: check.id, title: check.title, from: old.status, to: check.status });
    // Problem texts are written in the language of the scan; a different title means they cannot be matched.
    if (old.title !== check.title || !old.findings || !check.findings) {
      if (old.status !== "green" || check.status !== "green") diff.statusOnly.push(check.id);
      continue;
    }
    const changed = (finding: Finding): ChangedFinding => ({ checkId: check.id, title: check.title, file: finding.file, line: finding.line, problem: finding.problem });
    diff.fixed.push(...missingFrom(openFindings(old), openFindings(check)).map(changed));
    diff.added.push(...missingFrom(openFindings(check), openFindings(old)).map(changed));
  }
  return diff;
}

export function hasChanges(diff: ReportDiff): boolean {
  return diff.fixed.length > 0 || diff.added.length > 0 || diff.statusChanges.length > 0;
}

/** True when the status moved towards green. */
export function improved(change: StatusChange): boolean {
  return STATUS_RANK[change.to] > STATUS_RANK[change.from];
}

/** A commit SHA, which is what the GitHub Action sends as the ref of a pull request head. */
const COMMIT_SHA = /^[0-9a-f]{7,40}$/i;

/**
 * PostgREST filters for the newest public report of the same repository and ref saved before `report`, or null for a
 * private report: the viewer may not be allowed to see an older private scan, so private reports are never compared.
 * A CI scan of a commit has a ref no other report shares, so it is compared with the previous scan of the repository, whatever its ref.
 */
export function previousReportFilter(report: StoredReport): Record<string, string> | null {
  if (report.is_private) return null;
  const ref = report.results.repository.ref;
  // A CI scan of a branch is compared with the previous scan of that branch, a default branch scan with the default branch.
  const sameRef: Record<string, string> = ref && COMMIT_SHA.test(ref) ? {} : { "results->repository->>ref": ref ? `eq.${ref}` : "is.null" };
  return {
    // GitHub names ignore case and the scanner keeps the case that was typed; _ is a LIKE wildcard, so it is escaped.
    repo_url: `ilike.${report.repo_url.replace(/[\\_%]/g, "\\$&")}`,
    created_at: `lt.${report.created_at}`,
    ...sameRef,
    select: "id,repo_url,results,created_at",
    order: "created_at.desc",
    limit: "1",
  };
}
