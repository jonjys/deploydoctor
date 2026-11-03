import type { ReportResults } from "@/types/report";
import { defaultChecks } from "@/lib/stack";
import { isPartialPlaceholder } from "@/lib/report-insights";

export const LAUNCH_LIMITATIONS = [
  "Static repository analysis only; repository code was not installed, built or executed.",
  "Runtime behavior, live availability, traffic capacity, inventory and checkout were not tested.",
  "Hosting environment values, webhook delivery, payment fulfillment and database transactions were not verified.",
];
export function launchReadiness(results: ReportResults, reportId: string, isPrivate = false) {
  const excluded = (results.scope?.ignored ?? []).filter(category => !results.stack || defaultChecks(results.stack).includes(category));
  const base = `/r/${reportId}`;
  const findings = results.checks.filter(c => c.status !== "green" && !isPartialPlaceholder(c)).flatMap(check => {
    const items = check.findings?.length ? check.findings : [{ problem: check.explanation, fix: check.fix, file: null, line: null, ruleId: undefined, status: undefined, repairable: false }];
    return items.map((f, index) => ({
      id: `${check.id}:${f.ruleId ?? "finding"}:${index + 1}`, checkId: check.id, ruleId: f.ruleId ?? null,
      status: f.status ?? check.status, severity: (f.status ?? check.status) === "red" ? "blocker" : "review",
      problem: f.problem, evidence: f.file ? [`${f.file}:${f.line}`] : check.evidence,
      file: f.file, line: f.line, fix: f.fix, href: `${base}#check-${check.id}`,
      repair: !isPrivate && check.id === "imports" && f.repairable === true && results.repository.commitSha ? { kind: "verified-import-patch", href: `${base}#check-imports`, requiresEligibility: true } : null,
    }));
  });
  const criticalBlockers = findings.filter(f => f.status === "red");
  const reviewBeforeLaunch = findings.filter(f => f.status !== "red");
  const coverage = results.checks.map(c => ({ checkId: c.id, title: c.title, status: c.status, coverageOnly: isPartialPlaceholder(c), evaluatedRules: c.evaluatedRules ?? null }));
  const notVerified = [...LAUNCH_LIMITATIONS, ...(results.hosting?.limitations ?? []),
    ...(results.checks.some(isPartialPlaceholder) ? ["Some source checks have incomplete coverage; inspect the detailed report."] : []),
    ...(results.scan.partial ? ["Partial scan: unread files may contain additional problems."] : []),
    ...(excluded.length ? [`Excluded applicable check categories: ${excluded.join(", ")}.`] : []),
    ...(results.nextApp === "nested" ? ["Nested application: root framework configuration is not fully supported."] : []),
  ];
  const status = criticalBlockers.length ? "blocked" : reviewBeforeLaunch.length ? "review" : results.scan.partial || results.checks.some(isPartialPlaceholder) || excluded.length || !results.checks.length || results.nextApp === "nested" ? "incomplete" : "checks-passed";
  return {
    version: 1, status,
    statement: status === "checks-passed" ? "Deployment preflight passed the checks performed. Runtime behavior and checkout were not tested." : "Review the findings and coverage before launch. Runtime behavior and checkout were not tested.",
    criticalBlockers, reviewBeforeLaunch, notVerified, checksPerformed: coverage,
    nextAction: criticalBlockers[0]?.fix ?? reviewBeforeLaunch[0]?.fix ?? "Run a production build independently and verify the deployed application before sending traffic.",
    checklist: [
      ...[...criticalBlockers, ...reviewBeforeLaunch].map(f => ({ id: f.id, kind: "scan-finding", completed: false, action: f.fix, href: f.href })),
      ...["Verify production environment values and authorized callback URLs in your hosting dashboard.", "Run a clean production build and smoke-test the deployed application.", "If payments are used, perform a real end-to-end checkout test, signed webhook delivery and duplicate-event test before advertising."]
        .map((action, i) => ({ id: `manual-${i + 1}`, kind: "manual", completed: false, action, href: null })),
    ],
  };
}
