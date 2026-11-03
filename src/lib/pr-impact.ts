import { createDeployHandoff, type DeployHandoff } from "@/lib/deploy-handoff";
import type { CheckId, CheckResult, Finding, ReportResults } from "@/types/report";
import { isPartialPlaceholder } from "@/lib/report-insights";

export type ImpactFinding = Finding & { checkId: CheckId; title: string; status: "red" | "yellow" };
export type FindingOrigin = "introduced" | "existing" | "uncertain";
export type ContextualFinding = Finding & { prOrigin: FindingOrigin };

/** Attach comparison context to each current observation without modifying stored scan evidence.
 * Match the saved HEAD observations exactly (including their current line), not similar base text.
 * Queues preserve multiplicity when a rule emits the same observation more than once.
 */
export function contextualFindings(results: ReportResults): Map<CheckId, ContextualFinding[]> {
  const context = new Map<CheckId, ContextualFinding[]>(), impact = results.pullRequest;
  if (!impact) return context;
  const pinned = impact.version === 1 && /^[a-f0-9]{40}$/i.test(impact.baseCommitSha)
    && /^[a-f0-9]{40}$/i.test(impact.headCommitSha) && impact.headCommitSha === results.repository.commitSha;
  const key = (checkId: CheckId, f: Finding) => JSON.stringify([checkId, f.ruleId ?? "", f.file, f.line, f.problem]);
  const origins = new Map<string, FindingOrigin[]>();
  const add = (f: ImpactFinding, origin: FindingOrigin) => {
    const k = key(f.checkId, f);
    origins.set(k, [...(origins.get(k) ?? []), origin]);
  };
  // Existing observations match first, as in comparePullRequest's multiset consumption order.
  for (const f of impact.persisting) add(f, "existing");
  for (const f of impact.introduced) add(f, impact.partial || results.scan.partial ? "uncertain" : "introduced");
  for (const f of impact.uncertain) if (f.side === "head") add(f, "uncertain");
  for (const check of results.checks) {
    if (check.status === "green") continue;
    context.set(check.id, (check.findings ?? []).map(f => ({ ...f, status: f.status ?? (check.status === "red" ? "red" : "yellow"),
      prOrigin: pinned && !impact.notCompared.includes(check.id) ? origins.get(key(check.id, f))?.shift() ?? "uncertain" : "uncertain",
    })));
  }
  return context;
}
export type PullRequestImpact = {
  handoff?: DeployHandoff;
  version: 1;
  number: number;
  url: string;
  baseRef: string;
  /** The merge base, not the current tip of the target branch. */
  baseCommitSha: string;
  headCommitSha: string;
  partial: boolean;
  introduced: ImpactFinding[];
  persisting: ImpactFinding[];
  noLongerDetected: ImpactFinding[];
  uncertain: Array<ImpactFinding & { side: "base" | "head" }>;
  notCompared: CheckId[];
  limitations: string[];
};

const open = (check: CheckResult): ImpactFinding[] => check.status === "green" || isPartialPlaceholder(check) ? []
  : (check.findings ?? []).map(f => ({ ...f, checkId: check.id, title: check.title, status: f.status ?? (check.status === "red" ? "red" : "yellow") }));
const rules = (check: CheckResult) => JSON.stringify([...(check.evaluatedRules ?? [])].sort());

/** Compare observations, never infer a successful build or causal proof from missing findings.
 * Line numbers are deliberately excluded. Counts are a multiset so duplicate occurrences survive.
 * Rename metadata is supplied by GitHub's immutable commit comparison, never guessed from file names.
 */
export function comparePullRequest(base: ReportResults, head: ReportResults,
  meta: Pick<PullRequestImpact, "number" | "url" | "baseRef" | "baseCommitSha" | "headCommitSha">,
  renames: Record<string, string> = {}, renameCoverageComplete = true): PullRequestImpact {
  if (!/^[a-f0-9]{40}$/i.test(meta.baseCommitSha) || !/^[a-f0-9]{40}$/i.test(meta.headCommitSha)
    || base.repository.commitSha !== meta.baseCommitSha || head.repository.commitSha !== meta.headCommitSha
    || `${base.repository.owner}/${base.repository.name}`.toLowerCase() !== `${head.repository.owner}/${head.repository.name}`.toLowerCase()) {
    throw new Error("Comparison requires the exact repository and pinned commits.");
  }
  const partial = base.scan.partial || head.scan.partial || !renameCoverageComplete;
  const result: PullRequestImpact = { ...meta, version: 1, partial, introduced: [], persisting: [], noLongerDetected: [], uncertain: [], notCompared: [], limitations: [
    "Compared static findings at the PR merge base and head commit. This is not a build, merge simulation or proof that the PR caused a deployment failure.",
    "Findings are matched by check, rule, file and problem text, ignoring line movement. Reworded findings may appear as separate observations.",
    "Runtime behavior, hosting environment values, checkout and traffic capacity were not tested.",
  ] };
  if (partial) result.limitations.push("Coverage is incomplete. Unmatched findings cannot be classified as introduced or no longer detected.");
  const before = new Map(base.checks.map(c => [c.id, c]));
  const after = new Map(head.checks.map(c => [c.id, c]));
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(id), current = after.get(id);
    const comparable = old && current && old.title === current.title && rules(old) === rules(current)
      && !isPartialPlaceholder(old) && !isPartialPlaceholder(current);
    if (!comparable) {
      result.notCompared.push(id);
      result.uncertain.push(...(old ? open(old).map(f => ({ ...f, side: "base" as const })) : []),
        ...(current ? open(current).map(f => ({ ...f, side: "head" as const })) : []));
      continue;
    }
    const key = (f: ImpactFinding, side: "base" | "head") => JSON.stringify([f.ruleId ?? "", side === "base" && Object.hasOwn(renames, f.file) ? renames[f.file] : f.file, f.problem]);
    const remaining = new Map<string, ImpactFinding[]>();
    for (const f of open(old)) { const k = key(f, "base"); remaining.set(k, [...(remaining.get(k) ?? []), f]); }
    for (const f of open(current)) {
      const matches = remaining.get(key(f, "head"));
      if (matches?.length) { matches.shift(); result.persisting.push(f); }
      else if (partial) result.uncertain.push({ ...f, side: "head" });
      else result.introduced.push(f);
    }
    for (const f of [...remaining.values()].flat()) {
      if (partial) result.uncertain.push({ ...f, side: "base" });
      else result.noLongerDetected.push(f);
    }
    // Legacy/configuration-only results have no stable per-finding evidence to match.
    if ((old.status !== "green" && !old.findings?.length) || (current.status !== "green" && !current.findings?.length)) result.notCompared.push(id);
  }
  for (const list of [result.introduced, result.persisting, result.noLongerDetected, result.uncertain]) list.sort((a, b) => Number(a.status !== "red") - Number(b.status !== "red") || a.file.localeCompare(b.file) || a.line - b.line);
  const handoff = createDeployHandoff(base, head, renames, renameCoverageComplete);
  if (handoff) result.handoff = handoff;
  return result;
}
