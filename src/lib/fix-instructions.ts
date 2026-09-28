import type { CheckResult, StoredReport } from "@/types/report";
import { t, type Lang } from "@/lib/i18n";

function checkText(check: CheckResult, lang: Lang) {
  return [`${check.title}: ${check.explanation}`,
    ...(check.findings?.length ? check.findings.map((finding) =>
      `${t(lang, "fix.file")}: ${finding.file}:${finding.line} - ${finding.problem}.\n${t(lang, "fix.fix")}: ${finding.fix}${finding.command ? `\n${t(lang, "fix.command")}: ${finding.command}` : ""}`)
      : [...check.evidence.map((evidence) => `${t(lang, "fix.evidence")}: ${evidence}`), `${t(lang, "fix.fix")}: ${check.fix}`]),
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
