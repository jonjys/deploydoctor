import ts from "typescript";
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
  "expired", "delivery", "payment", "pending", "access", "report"] as const;
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
  if (findSecrets(source).length) throw new PatchError("The file contains what looks like a live credential, so it is never copied into a patch.", 422, "secret");
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

/**
 * A git-style unified diff for an edit that replaces text inside lines without adding or removing any,
 * which is all a case fix does. Three lines of context, overlapping hunks merged.
 */
export function unifiedDiff(filePath: string, before: string, after: string): string {
  const finalNewline = before.endsWith("\n");
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  if (finalNewline) { oldLines.pop(); newLines.pop(); }
  if (oldLines.length !== newLines.length || finalNewline !== after.endsWith("\n")) throw new PatchError("The patch would change the line structure.", 500, "verify");
  const changed = oldLines.flatMap((line, index) => line === newLines[index] ? [] : [index]);
  if (!changed.length) return "";

  const hunks: Array<{ start: number; end: number }> = [];
  for (const index of changed) {
    const start = Math.max(0, index - 3);
    const end = Math.min(oldLines.length, index + 4);
    const last = hunks.at(-1);
    if (last && start <= last.end) last.end = end;
    else hunks.push({ start, end });
  }

  const noNewline = "\\ No newline at end of file";
  const isLast = (index: number) => index === oldLines.length - 1 && !finalNewline;
  const body = hunks.map(({ start, end }) => {
    const lines = [`@@ -${start + 1},${end - start} +${start + 1},${end - start} @@`];
    for (let index = start; index < end; index++) {
      if (oldLines[index] === newLines[index]) {
        lines.push(` ${oldLines[index]}`);
        if (isLast(index)) lines.push(noNewline);
      } else {
        lines.push(`-${oldLines[index]}`);
        if (isLast(index)) lines.push(noNewline);
        lines.push(`+${newLines[index]}`);
        if (isLast(index)) lines.push(noNewline);
      }
    }
    return lines.join("\n");
  });
  return `diff --git a/${filePath} b/${filePath}\n--- a/${filePath}\n+++ b/${filePath}\n${body.join("\n")}\n`;
}
