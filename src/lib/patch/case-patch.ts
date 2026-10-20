import ts from "typescript";
import { createHash } from "node:crypto";
import { findSecrets } from "@/lib/secrets";

/**
 * Writes the patch for import specifiers whose letter case differs from the tracked file.
 * Ported from ImportFix (github.com/jonjys/importfix, src/lib/import-patch.ts) and widened from one
 * import to every case-only fix in a file. The rules stay the same: only a module-specifier string
 * literal is touched, only its letter case changes, and anything the parser cannot read exactly is
 * refused rather than guessed.
 */
/** Why a file, an import or an order was refused. The page shows each code in the visitor's language. */
export const PATCH_REASONS = ["path", "size", "crlf", "secret", "syntax", "case", "import", "escaped", "verify", "too-large",
  "expired", "delivery", "payment", "pending", "access", "report", "ambiguous", "missing", "version", "link"] as const;
export type PatchReason = typeof PATCH_REASONS[number];
export class PatchError extends Error {
  constructor(message: string, public readonly status = 422, public readonly code: PatchReason = "verify") { super(message); }
}

export type CaseEdit = { specifier: string; exact: string };
export type FilePatch = { filePath: string; diff: string; after: string; applied: CaseEdit[]; skipped: Array<CaseEdit & { reason: PatchReason }> };

const PATCHABLE_FILE = /^[\w./@()[\]$+~-]{1,220}\.[cm]?[jt]sx?$/;
export const MAX_PATCH_SOURCE_BYTES = 256_000;

function moduleSpecifierLiterals(file: ts.SourceFile): ts.StringLiteral[] {
  const found: ts.StringLiteral[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push(node.moduleSpecifier);
    } else if (ts.isCallExpression(node) && node.arguments.length >= 1 && ts.isStringLiteral(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      found.push(node.arguments[0]);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      found.push(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

export function buildCasePatch(filePath: string, source: string, edits: CaseEdit[]): FilePatch {
  if (!PATCHABLE_FILE.test(filePath) || filePath.startsWith("/") || filePath.split("/").some((part) => !part || part === "." || part === ".."))
    throw new PatchError("Only JavaScript and TypeScript source files with plain paths are patched automatically.", 422, "path");
  if (Buffer.byteLength(source) > MAX_PATCH_SOURCE_BYTES || source.includes("\0"))
    throw new PatchError("The file is too large or not plain text.", 422, "size");
  if (source.includes("\r")) throw new PatchError("The file uses Windows line endings; apply the change by hand.", 422, "crlf");
  if (findSecrets(source).length || /(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|sk_test_[A-Za-z0-9]{24,}|gh[ousr]_[A-Za-z0-9]{20,})/.test(source)) throw new PatchError("The file contains what looks like a live credential, so it is never copied into a patch.", 422, "secret");
  const parsed = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  if ((parsed as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length)
    throw new PatchError("The file has syntax errors, so no automatic patch is offered.", 422, "syntax");

  const literals = moduleSpecifierLiterals(parsed);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const applied: CaseEdit[] = [];
  const skipped: FilePatch["skipped"] = [];
  const seen = new Set<string>();
  for (const edit of edits) {
    if (seen.has(edit.specifier)) continue;
    seen.add(edit.specifier);
    if (edit.exact === edit.specifier || edit.exact.toLowerCase() !== edit.specifier.toLowerCase()) {
      skipped.push({ ...edit, reason: "case" });
      continue;
    }
    const matches = literals.filter((literal) => literal.text === edit.specifier);
    if (!matches.length) { skipped.push({ ...edit, reason: "import" }); continue; }
    const spans = matches.map((literal) => ({ start: literal.getStart(parsed) + 1, end: literal.getEnd() - 1 }));
    if (spans.some(({ start, end }) => source.slice(start, end) !== edit.specifier)) {
      skipped.push({ ...edit, reason: "escaped" });
      continue;
    }
    for (const span of spans) replacements.push({ ...span, text: edit.exact });
    applied.push(edit);
  }

  let after = source;
  for (const { start, end, text } of [...replacements].sort((left, right) => right.start - left.start)) {
    after = after.slice(0, start) + text + after.slice(end);
  }
  return { filePath, diff: applied.length ? unifiedDiff(filePath, source, after) : "", after, applied, skipped };
}

/** Full-file context, adapted from DeployFix: any changed source line makes git apply --check refuse. */
export function unifiedDiff(filePath: string, before: string, after: string): string {
  if (before === after) return "";
  const finalNewline = before.endsWith("\n");
  const oldLines = before.split("\n"), newLines = after.split("\n");
  if (finalNewline) { oldLines.pop(); newLines.pop(); }
  if (oldLines.length !== newLines.length || finalNewline !== after.endsWith("\n"))
    throw new PatchError("The patch would change the line structure.", 500, "verify");
  const rows: string[] = [];
  for (let i = 0; i < oldLines.length; i++) {
    if (oldLines[i] === newLines[i]) rows.push(` ${oldLines[i]}`);
    else {
      rows.push(`-${oldLines[i]}`);
      if (i === oldLines.length - 1 && !finalNewline) rows.push("\\ No newline at end of file");
      rows.push(`+${newLines[i]}`);
    }
    if (i === oldLines.length - 1 && !finalNewline) rows.push("\\ No newline at end of file");
  }
  const diff = `diff --git a/${filePath} b/${filePath}\nindex ${gitBlobHash(before)}..${gitBlobHash(after)}\n--- a/${filePath}\n+++ b/${filePath}\n@@ -1,${oldLines.length} +1,${newLines.length} @@\n${rows.join("\n")}\n`;
  if (applyVerifiedDiff(filePath, before, diff) !== after) throw new PatchError("Patch verification failed.", 500, "verify");
  return diff;
}

const gitBlobHash = (source: string) => createHash("sha1").update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest("hex");
export const sourceHash = (source: string) => createHash("sha256").update(source).digest("hex");

/** Strict application of our full-context, single-file diff. Pure text processing; never executes repo code. */
export function applyVerifiedDiff(filePath: string, source: string, diff: string): string {
  const rows = diff.split("\n");
  const title = rows.shift();
  const index = /^index ([a-f0-9]{40})\.\.([a-f0-9]{40})$/.exec(rows.shift() ?? "");
  if (title !== `diff --git a/${filePath} b/${filePath}` || !index || rows.shift() !== `--- a/${filePath}`
    || rows.shift() !== `+++ b/${filePath}`) throw new PatchError("Invalid patch path.", 422, "verify");
  const header = /^@@ -1,(\d+) \+1,(\d+) @@$/.exec(rows.shift() ?? "");
  if (!header || rows.pop() !== "") throw new PatchError("Invalid patch hunk.", 422, "verify");
  const oldLines: string[] = [], newLines: string[] = [];
  let oldNewline = true, newNewline = true, previous = "";
  for (const row of rows) {
    const kind = row[0];
    if (row === "\\ No newline at end of file") {
      if (previous === " " || previous === "-") oldNewline = false;
      if (previous === " " || previous === "+") newNewline = false;
      continue;
    }
    if (kind === " " || kind === "-") oldLines.push(row.slice(1));
    if (kind === " " || kind === "+") newLines.push(row.slice(1));
    if (![" ", "-", "+"].includes(kind)) throw new PatchError("Invalid patch body.", 422, "verify");
    previous = kind;
  }
  const original = oldLines.join("\n") + (oldNewline ? "\n" : "");
  if (oldLines.length !== Number(header[1]) || newLines.length !== Number(header[2]) || original !== source)
    throw new PatchError("Source changed; rescan instead of forcing the patch.", 409, "version");
  const after = newLines.join("\n") + (newNewline ? "\n" : "");
  if (gitBlobHash(source) !== index[1] || gitBlobHash(after) !== index[2]) throw new PatchError("Patch hash mismatch.", 409, "version");
  return after;
}
