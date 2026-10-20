import { importProblems, type ImportProblem, type RepositorySnapshot } from "@/lib/analyzer";
import { buildCasePatch, sourceHash, PatchError, type PatchReason } from "@/lib/patch/case-patch";

export type PlannedFix = { file: string; line: number; from: string; to: string };
export type SkippedFix = { file: string; line: number; specifier: string; reason: PatchReason };
export type CasePatchPlan = { patch: string; files: string[]; fixes: PlannedFix[]; skipped: SkippedFix[]; sourceHashes?: Record<string, string> };

/** Big enough for every realistic case fix, small enough to travel encrypted in Stripe metadata. */
export const MAX_PATCH_BYTES = 24_000;

const key = (problem: Pick<ImportProblem, "file" | "line" | "specifier">) => `${problem.file}\n${problem.line}\n${problem.specifier}`;

/**
 * Builds one patch for every letter-case import problem in the snapshot, then proves it: the analyzer
 * runs again on the patched files and every patched import must resolve, with no new problem anywhere.
 * `fixes` is empty when nothing can be fixed automatically, and `skipped` says why. Throws when a built
 * patch fails its own proof.
 */
export function planCasePatch(snapshot: RepositorySnapshot): CasePatchPlan {
  const before = importProblems(snapshot);
  const byFile = new Map<string, Extract<ImportProblem, { kind: "case" }>[]>();
  for (const problem of before) {
    if (problem.kind !== "case") continue;
    byFile.set(problem.file, [...(byFile.get(problem.file) ?? []), problem]);
  }

  const patched = new Map(snapshot.contents);
  const diffs: string[] = [];
  const fixes: PlannedFix[] = [];
  const skipped: SkippedFix[] = before.filter(p => p.kind === "missing").map(p => ({
    file: p.file, line: p.line, specifier: p.specifier, reason: p.kind === "missing" && p.ambiguous ? "ambiguous" : "missing",
  }));
  for (const [file, problems] of [...byFile].sort(([left], [right]) => left.localeCompare(right))) {
    const source = snapshot.contents.get(file);
    if (source === undefined) continue;
    try {
      const result = buildCasePatch(file, source, problems.map(({ specifier, exact }) => ({ specifier, exact })));
      for (const problem of problems) {
        const done = result.applied.some((edit) => edit.specifier === problem.specifier);
        if (done) fixes.push({ file, line: problem.line, from: problem.specifier, to: problem.exact });
        else skipped.push({ file, line: problem.line, specifier: problem.specifier,
          reason: result.skipped.find((edit) => edit.specifier === problem.specifier)?.reason ?? "import" });
      }
      if (result.diff) { diffs.push(result.diff); patched.set(file, result.after); }
    } catch (error) {
      if (!(error instanceof PatchError)) throw error;
      for (const problem of problems) skipped.push({ file, line: problem.line, specifier: problem.specifier, reason: error.code });
    }
  }
  if (!fixes.length) return { patch: "", files: [], fixes: [], skipped };

  // Proof: re-run the same detection on the patched code. Line numbers do not move, because a case fix
  // only changes letters inside a string, so problems compare one to one. Any problem that was not there
  // before (a corrected import that still does not resolve, for one) means the patch is wrong.
  const after = importProblems({ ...snapshot, contents: patched });
  const beforeKeys = new Set(before.map(key));
  if (after.some((problem) => !beforeKeys.has(key(problem)))) {
    throw new PatchError("The patch did not pass its own verification, so it is not offered.", 500, "verify");
  }
  // A fix only counts once its parsed import problem is gone; comments and strings are ignored.
  const afterKeys = new Set(after.map(key));
  const verified = fixes.filter((fix) => !afterKeys.has(key({ file: fix.file, line: fix.line, specifier: fix.from })));
  for (const fix of fixes) {
    if (!verified.includes(fix)) skipped.push({ file: fix.file, line: fix.line, specifier: fix.from, reason: "import" });
  }
  if (!verified.length) return { patch: "", files: [], fixes: [], skipped };

  const patch = diffs.join("");
  if (Buffer.byteLength(patch) > MAX_PATCH_BYTES) throw new PatchError("The patch is too large for automatic delivery.", 422, "too-large");
  return { patch, files: [...new Set(verified.map((fix) => fix.file))], fixes: verified, skipped,
    sourceHashes: Object.fromEntries([...new Set(verified.map(fix => fix.file))].map(file => [file, sourceHash(snapshot.contents.get(file)!)])) };
}
