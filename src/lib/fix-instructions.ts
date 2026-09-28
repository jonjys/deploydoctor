import type { CheckResult, StoredReport } from "@/types/report";
import { t, type Lang } from "@/lib/i18n";

function checkText(check: CheckResult, lang: Lang) {
  const file = check.suggestedFile;
  // With a complete file to copy, the per-line findings that only say "add this to the file" are left out.
  const findings = file ? check.findings?.filter((finding) => finding.command !== file.command) : check.findings;
  const fileText = file ? [`${t(lang, "fix.completeFile", { path: file.path })}:\n\`\`\`\n${file.content}\`\`\`${file.command ? `\n${t(lang, "fix.command")}: ${file.command}` : ""}`] : [];
  return [`${check.title}: ${check.explanation}`,
    ...(findings?.length ? findings.map((finding) =>
      `${t(lang, "fix.file")}: ${finding.file}:${finding.line} - ${finding.problem}.\n${t(lang, "fix.fix")}: ${finding.fix}${finding.command ? `\n${t(lang, "fix.command")}: ${finding.command}` : ""}`)
      : file ? [] : [...check.evidence.map((evidence) => `${t(lang, "fix.evidence")}: ${evidence}`), `${t(lang, "fix.fix")}: ${check.fix}`]),
    ...fileText,
  ].join("\n");
}

/** Pieces are joined on the client so issues the reader ignored can be left out. */
export function freeFixParts(report: StoredReport, lang: Lang = "en") {
  return {
    head: t(lang, "fix.head", { url: report.repo_url }),
    items: report.results.checks.filter((check) => check.status !== "green").map((check) => ({ id: check.id, text: checkText(check, lang) })),
    allPassed: t(lang, "fix.allPassed"),
  };
}

export function joinFixParts(parts: ReturnType<typeof freeFixParts>, ignored: ReadonlySet<string> = new Set()) {
  const open = parts.items.filter((item) => !ignored.has(item.id));
  return [parts.head, ...open.map((item) => item.text), open.length ? "" : parts.allPassed].filter(Boolean).join("\n\n");
}

export function freeFixInstructions(report: StoredReport, lang: Lang = "en") {
  return joinFixParts(freeFixParts(report, lang));
}
