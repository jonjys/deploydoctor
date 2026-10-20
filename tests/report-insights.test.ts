import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FixFirst, IgnoreProvider } from "../src/components/report-ignore";
import { LangProvider } from "../src/components/lang";
import { SinceLastScan } from "../src/components/report-since";
import { messages, t } from "../src/lib/i18n";
import { analysisText } from "../src/lib/analysis-text";
import { diffReports, fixFirstItems, hasChanges, improved, isPartialPlaceholder, previousReportFilter, severityOf, showsLocalWhy, type FixFirstItem } from "../src/lib/report-insights";
import type { CheckId, CheckResult, CheckStatus, Finding, ReportResults, StoredReport } from "../src/types/report";

/** Paths render with a break opportunity after every slash; most assertions read them without it. */
const plain = (html: string) => html.replaceAll("<wbr/>", "");

const CHECK_IDS = Object.keys(severityOf) as CheckId[];

function check(id: CheckId, status: CheckStatus, findings?: Finding[], extra: Partial<CheckResult> = {}): CheckResult {
  return { id, title: `Title ${id}`, status, explanation: `${id} explained`, fix: `fix ${id}`, evidence: [], ...(findings ? { findings } : {}), ...extra };
}

function finding(file: string, line: number, problem: string, command?: string): Finding {
  return { file, line, problem, fix: `fix ${problem}`, ...(command ? { command } : {}) };
}

function results(checks: CheckResult[], partial = false, ref?: string): ReportResults {
  return {
    repository: { owner: "acme", name: "shop_app", defaultBranch: "main", ...(ref ? { ref } : {}) },
    checkedAt: "2026-10-17T10:00:00.000Z",
    scan: { filesInTree: 10, sourceFilesRead: 5, sourceFilesFound: 5, partial },
    summary: { red: 0, yellow: 0, green: 0 },
    overall: "green",
    checks,
  };
}

test("fix first orders red before yellow, then build, runtime and security, then report order", () => {
  const items = fixFirstItems([
    check("secrets", "red", [finding("lib/stripe.ts", 3, "contains a key")]),
    check("build-config", "yellow", [finding("vercel.json", 2, "cron too often")]),
    check("env", "red", [finding("app/page.tsx", 9, "API_KEY is missing")]),
    check("next-entry", "green", []),
    check("imports", "red", [finding("app/a.tsx", 1, "imports ./B"), finding("app/c.tsx", 4, "imports ./D", "git add -- app/D.tsx")]),
    check("supabase", "yellow", [finding("supabase/migrations/1.sql", 5, "no grants")]),
    check("dependencies", "red", [finding("app/x.ts", 2, "imports zod")]),
  ]);
  assert.deepEqual(items.map((item) => `${item.checkId} ${item.file}:${item.line}`), [
    "imports app/a.tsx:1", "imports app/c.tsx:4", "dependencies app/x.ts:2", "env app/page.tsx:9", "secrets lib/stripe.ts:3",
    "build-config vercel.json:2", "supabase supabase/migrations/1.sql:5",
  ]);
  assert.equal(items[1].command, "git add -- app/D.tsx");
  assert.equal(items[0].command, undefined);
  assert.equal(items[0].fix, "fix imports ./B");
  assert.equal(items[0].status, "red");
  assert.equal(items.at(-1)?.status, "yellow");
});

test("fix first is empty when every check passes, and a check without findings is one item with its own fix", () => {
  assert.deepEqual(fixFirstItems([check("imports", "green", []), check("env", "green", [])]), []);
  // Reports saved before findings existed, and checks such as the entrypoint that never have any.
  const [item] = fixFirstItems([check("next-entry", "red", undefined), check("imports", "green")]);
  assert.deepEqual(item, { checkId: "next-entry", title: "Title next-entry", status: "red", fix: "fix next-entry" });
});

test("findings that only add a line to the suggested complete file collapse into one item for that file", () => {
  const items = fixFirstItems([check("env", "red", [
    finding(".gitignore", 3, "ignores .env.example", "git add -- .gitignore .env.example"),
    finding("app/a.ts", 1, "A is missing", "git add -- .env.example"),
    finding("app/b.ts", 2, "B is missing", "git add -- .env.example"),
  ], { suggestedFile: { path: ".env.example", content: "A=\nB=\n", command: "git add -- .env.example" } })]);
  assert.equal(items.length, 2);
  assert.equal(items[0].file, ".gitignore");
  assert.deepEqual(items[1], { checkId: "env", title: "Title env", status: "red", file: ".env.example", command: "git add -- .env.example", completeFile: ".env.example" });
});

function renderFixFirst(items: FixFirstItem[], lang: "en" | "sv" = "en") {
  // The children go in as arguments; the casts only tell TypeScript the props are complete with them.
  return renderToStaticMarkup(createElement(LangProvider, { lang } as ComponentProps<typeof LangProvider>,
    createElement(IgnoreProvider, { reportId: "r1" } as ComponentProps<typeof IgnoreProvider>, createElement(FixFirst, { items }))));
}

test("the fix first list shows at most five items, links to the full list and copies commands", () => {
  const items = fixFirstItems([check("imports", "red", Array.from({ length: 7 }, (_, index) =>
    finding(`app/f${index}.tsx`, index + 1, `imports ./m${index}`, index === 0 ? "git add -- app/M0.tsx" : undefined)))]);
  const html = plain(renderFixFirst(items));
  assert.equal(html.match(/<li /g)?.length, 5);
  assert.match(html, /app\/f0\.tsx:1/);
  assert.match(html, /app\/f4\.tsx:5/);
  assert.doesNotMatch(html, /app\/f5\.tsx/);
  assert.match(html, /href="#checks"[^>]*>See all 7 items</);
  assert.match(html, /<code>git add -- app\/M0\.tsx<\/code>/);
  assert.match(html, /Copy command/);
  assert.match(html, /href="#check-imports"/);
  assert.match(renderFixFirst(items, "sv"), /Visa alla 7 punkter/);
  // Five or fewer items need no link, and an all-green report shows nothing.
  assert.doesNotMatch(renderFixFirst(items.slice(0, 5)), /#checks/);
  assert.equal(renderFixFirst([]), "");
});

test("the comparison matches findings by check, file and problem, not by line", () => {
  const previous = results([
    check("imports", "red", [finding("app/a.tsx", 3, "imports ./B"), finding("app/c.tsx", 8, "imports ./D")]),
    check("env", "red", [finding("app/page.tsx", 4, "API_KEY is missing")]),
    check("secrets", "green", []),
  ]);
  const current = results([
    // The import moved two lines down when code above it was edited: same finding.
    check("imports", "red", [finding("app/a.tsx", 5, "imports ./B"), finding("app/e.tsx", 1, "imports ./F")]),
    check("env", "green", []),
    check("secrets", "red", [finding("lib/stripe.ts", 2, "contains a key")]),
  ]);
  const diff = diffReports(previous, current);
  assert.deepEqual(diff.fixed.map((item) => `${item.checkId} ${item.file}:${item.line} ${item.problem}`),
    ["imports app/c.tsx:8 imports ./D", "env app/page.tsx:4 API_KEY is missing"]);
  assert.deepEqual(diff.added.map((item) => `${item.checkId} ${item.file}:${item.line} ${item.problem}`),
    ["imports app/e.tsx:1 imports ./F", "secrets lib/stripe.ts:2 contains a key"]);
  assert.deepEqual(diff.statusChanges.map(({ checkId, from, to }) => `${checkId} ${from}>${to}`), ["env red>green", "secrets green>red"]);
  assert.deepEqual(diff.statusChanges.map(improved), [true, false]);
  assert.deepEqual(diff.statusOnly, []);
  assert.equal(diff.partial, false);
  assert.equal(hasChanges(diff), true);
});

test("the same problem in another file, or in another check, is a different finding", () => {
  const diff = diffReports(
    results([check("imports", "red", [finding("app/a.tsx", 1, "imports ./B")]), check("dependencies", "red", [finding("app/x.ts", 1, "imports zod")])]),
    results([check("imports", "red", [finding("app/z.tsx", 1, "imports ./B")]), check("dependencies", "red", [finding("app/x.ts", 1, "imports zod!")])]),
  );
  assert.deepEqual(diff.fixed.map((item) => item.file), ["app/a.tsx", "app/x.ts"]);
  assert.deepEqual(diff.added.map((item) => item.file), ["app/z.tsx", "app/x.ts"]);
});

test("repeated identical findings are counted, so one fixed copy of two shows as fixed", () => {
  const twice = [finding("app/a.tsx", 1, "imports ./B"), finding("app/a.tsx", 9, "imports ./B")];
  const diff = diffReports(results([check("imports", "red", twice)]), results([check("imports", "red", [twice[1]])]));
  assert.equal(diff.fixed.length, 1);
  assert.equal(diff.added.length, 0);
  assert.deepEqual(diffReports(results([check("imports", "red", twice)]), results([check("imports", "red", twice)])).fixed, []);
});

test("identical scans have no changes, and a status change alone is a change", () => {
  const scan = results([check("imports", "red", [finding("app/a.tsx", 1, "imports ./B")]), check("env", "yellow", [])]);
  const same = diffReports(scan, scan);
  assert.equal(hasChanges(same), false);
  const moved = diffReports(scan, results([check("imports", "red", [finding("app/a.tsx", 1, "imports ./B")]), check("env", "red", [])]));
  assert.equal(hasChanges(moved), true);
  assert.deepEqual(moved.statusChanges.map(({ checkId, from, to }) => `${checkId} ${from}>${to}`), ["env yellow>red"]);
  assert.equal(improved(moved.statusChanges[0]), false);
});

test("checks only one of the scans ran are not compared, and are listed as such", () => {
  const diff = diffReports(
    results([check("imports", "red", [finding("app/a.tsx", 1, "imports ./B")]), check("env", "red", [])]),
    results([check("env", "red", []), check("prisma", "red", [finding("package.json", 1, "no generate")])]),
  );
  assert.equal(hasChanges(diff), false);
  assert.equal(diff.compared, 1);
  assert.deepEqual(diff.notCompared, [{ checkId: "imports", title: "Title imports" }, { checkId: "prisma", title: "Title prisma" }]);
  // A finding of a check the previous scan did not run is not new code, so it is never listed as new.
  assert.deepEqual(diff.added, []);
  const html = renderToStaticMarkup(createElement(SinceLastScan, { diff, previous: { id: "22222222-2222-4222-8222-222222222222", created_at: "2026-10-10T08:30:00.000Z" }, lang: "en" }));
  assert.doesNotMatch(html, /New \(/);
  assert.doesNotMatch(html, /package\.json/);
  assert.match(html, /Ran in only one of the two scans, so not compared: Title imports, Title prisma\./);
});

test("the since section is hidden when the two scans share no check", () => {
  const previous = { id: "22222222-2222-4222-8222-222222222222", created_at: "2026-10-10T08:30:00.000Z" };
  const diff = diffReports(
    results([check("supabase", "green", [])]),
    results([check("imports", "red", [finding("app/a.tsx", 1, "imports ./B")]), check("env", "red", [finding("app/b.ts", 2, "X is missing")])]),
  );
  assert.equal(diff.compared, 0);
  for (const lang of ["en", "sv"] as const) {
    assert.equal(renderToStaticMarkup(createElement(SinceLastScan, { diff, previous, lang })), "");
  }
  assert.equal(renderToStaticMarkup(createElement(SinceLastScan, { diff: diffReports(results([]), results([])), previous, lang: "en" })), "");
});

test("with some checks in common, the since section says which checks were not compared", () => {
  const previous = { id: "22222222-2222-4222-8222-222222222222", created_at: "2026-10-10T08:30:00.000Z" };
  const same = diffReports(
    results([check("env", "green", []), check("supabase", "green", [])]),
    results([check("env", "green", []), check("imports", "red", [finding("app/a.tsx", 1, "imports ./B")])]),
  );
  const html = renderToStaticMarkup(createElement(SinceLastScan, { diff: same, previous, lang: "en" }));
  assert.match(html, /Nothing changed in the checks both scans ran\./);
  assert.doesNotMatch(html, /Nothing changed since then\./);
  assert.match(html, /Ran in only one of the two scans, so not compared: Title supabase, Title imports\./);
  const sv = renderToStaticMarkup(createElement(SinceLastScan, { diff: same, previous, lang: "sv" }));
  assert.match(sv, /Inget har ändrats i kontrollerna som båda skanningarna körde\./);
  assert.match(sv, /Kördes bara i en av skanningarna och jämförs därför inte: Title supabase, Title imports\./);
  const changed = diffReports(
    results([check("env", "red", [finding("app/b.ts", 2, "X is missing")]), check("supabase", "green", [])]),
    results([check("env", "green", [])]),
  );
  const changedHtml = renderToStaticMarkup(createElement(SinceLastScan, { diff: changed, previous, lang: "en" }));
  assert.match(changedHtml, /Fixed \(1\)/);
  assert.doesNotMatch(changedHtml, /Nothing changed/);
  assert.match(changedHtml, /so not compared: Title supabase\./);
  // When every check ran in both scans there is no such note.
  const full = renderToStaticMarkup(createElement(SinceLastScan, { diff: diffReports(results([check("env", "green", [])]), results([check("env", "green", [])])), previous, lang: "en" }));
  assert.match(full, /Nothing changed since then\./);
  assert.doesNotMatch(full, /not compared/);
});

test("findings of another language or of an older report are not matched; only the status is compared", () => {
  const english = results([check("imports", "red", [finding("app/a.tsx", 1, "imports ./B")])]);
  const swedish = results([check("imports", "red", [finding("app/a.tsx", 1, "importerar ./B")], { title: "Trasiga importer" })]);
  const diff = diffReports(english, swedish);
  assert.deepEqual(diff.fixed, []);
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.statusOnly, ["imports"]);
  const old = results([check("env", "red", undefined)]);
  const fixed = diffReports(old, results([check("env", "green", [])]));
  assert.deepEqual(fixed.statusChanges.map(({ from, to }) => `${from}>${to}`), ["red>green"]);
  assert.deepEqual(fixed.statusOnly, ["env"]);
  // Nothing to compare when the check passed both times.
  assert.deepEqual(diffReports(results([check("env", "green", undefined)]), results([check("env", "green", [])])).statusOnly, []);
});

test("findings a passing check still carries do not count as open", () => {
  const diff = diffReports(
    results([check("env", "green", [finding("app/a.ts", 1, "X is optional")])]),
    results([check("env", "yellow", [finding("app/a.ts", 1, "X is optional")])]),
  );
  assert.equal(diff.added.length, 1);
  assert.equal(diff.fixed.length, 0);
});

test("a partial scan on either side is flagged", () => {
  assert.equal(diffReports(results([], true), results([])).partial, true);
  assert.equal(diffReports(results([]), results([], true)).partial, true);
});

test("the since section links the previous report and lists what was fixed and what is new", () => {
  const previous = { id: "22222222-2222-4222-8222-222222222222", created_at: "2026-10-10T08:30:00.000Z" };
  const diff = diffReports(
    results([check("imports", "red", Array.from({ length: 7 }, (_, index) => finding(`app/f${index}.tsx`, index + 1, `imports ./m${index}`)))], true),
    results([check("imports", "red", [finding("app/new.tsx", 2, "imports ./Gone")])]),
  );
  const html = plain(renderToStaticMarkup(createElement(SinceLastScan, { diff, previous, lang: "en" })));
  assert.match(html, /Since the previous scan/);
  assert.match(html, /href="\/r\/22222222-2222-4222-8222-222222222222"[^>]*>Previous report from Oct 10, 2026, 8:30\s?AM UTC</);
  assert.match(html, /Fixed \(7\)/);
  assert.match(html, /href="\/r\/22222222-2222-4222-8222-222222222222#check-imports"><code>app\/f0\.tsx:1<\/code><\/a> imports \.\/m0/);
  assert.doesNotMatch(html, /app\/f5\.tsx/);
  assert.match(html, /and 2 more/);
  assert.match(html, /New \(1\)/);
  assert.match(html, /href="#check-imports"><code>app\/new\.tsx:2<\/code>/);
  assert.match(html, /did not read every file/);
  const same = renderToStaticMarkup(createElement(SinceLastScan, { diff: diffReports(results([check("env", "green", [])]), results([check("env", "green", [])])), previous, lang: "sv" }));
  assert.match(same, /Sedan förra skanningen/);
  assert.match(same, /Inget har ändrats sedan dess\./);
  assert.doesNotMatch(same, /since-last-lists/);
});

function stored(extra: Partial<StoredReport> = {}, ref?: string): StoredReport {
  return { id: "11111111-1111-4111-8111-111111111111", repo_url: "https://github.com/acme/shop_app", results: results([], false, ref),
    created_at: "2026-10-17T10:00:00.123456+00:00", ...extra };
}

test("the previous report is looked up among public reports of the same repository and ref, newest first", () => {
  const filter = previousReportFilter(stored());
  assert.ok(filter);
  // Case-insensitive, with the LIKE wildcard _ escaped so acme/shop_app never matches acme/shopXapp.
  assert.equal(filter.repo_url, "ilike.https://github.com/acme/shop\\_app");
  assert.equal(filter.created_at, "lt.2026-10-17T10:00:00.123456+00:00");
  assert.equal(filter["results->repository->>ref"], "is.null");
  assert.equal(filter.order, "created_at.desc");
  assert.equal(filter.limit, "1");
  assert.equal(previousReportFilter(stored({}, "feature/login"))?.["results->repository->>ref"], "eq.feature/login");
  // The URL keeps the + of the timezone offset as %2B, so PostgREST does not read it as a space.
  assert.match(String(new URLSearchParams(filter)), /created_at=lt\.2026-10-17T10%3A00%3A00\.123456%2B00%3A00/);
});

test("private reports are never compared", () => {
  assert.equal(previousReportFilter(stored({ is_private: true })), null);
});

test("a CI scan of a commit is compared with the previous scan of the repository, whatever its ref", () => {
  // The GitHub Action sends the pull request head SHA, which no other report shares; a filter on it would never match.
  for (const sha of ["a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", "A1B2C3D4E5F60718293A4B5C6D7E8F9012345678", "a1b2c3d"]) {
    const filter = previousReportFilter(stored({}, sha));
    assert.ok(filter);
    assert.equal("results->repository->>ref" in filter, false, sha);
    assert.equal(filter.repo_url, "ilike.https://github.com/acme/shop\\_app");
    assert.equal(filter.created_at, "lt.2026-10-17T10:00:00.123456+00:00");
    assert.equal(filter.order, "created_at.desc");
  }
  // Branch names, even hex-looking short ones, and the default branch keep their own line of history.
  assert.equal(previousReportFilter(stored({}, "feature/login"))?.["results->repository->>ref"], "eq.feature/login");
  assert.equal(previousReportFilter(stored({}, "deadbe"))?.["results->repository->>ref"], "eq.deadbe");
  assert.equal(previousReportFilter(stored({}, "v1.2.3"))?.["results->repository->>ref"], "eq.v1.2.3");
  assert.equal(previousReportFilter(stored())?.["results->repository->>ref"], "is.null");
});

test("partial-scan placeholders are left out of fix first, so operator advice never shows there", () => {
  for (const lang of ["en", "sv"] as const) {
    const x = analysisText(lang);
    for (const fix of [x.partialFixToken, x.partialFixRetry]) {
      const placeholder = check("dependencies", "yellow", [], { fix, explanation: x.deps.partial });
      assert.equal(isPartialPlaceholder(placeholder), true, `${lang} ${fix}`);
      const items = fixFirstItems([
        check("imports", "red", [finding("app/a.tsx", 1, "imports ./B")]),
        placeholder,
        check("env", "yellow", [], { fix }),
        check("secrets", "yellow", [], { fix }),
      ]);
      assert.deepEqual(items.map((item) => item.checkId), ["imports"]);
      assert.doesNotMatch(renderFixFirst(items, lang), /GITHUB_TOKEN|Vercel > Settings/);
    }
  }
  assert.match(analysisText("en").partialFixToken, /GITHUB_TOKEN/);
  // A review item with findings, the entrypoint check with its own advice and a red check are real items whatever the scan read.
  assert.equal(isPartialPlaceholder(check("supabase", "yellow", [finding("supabase/migrations/1.sql", 5, "no grants")])), false);
  assert.equal(isPartialPlaceholder(check("next-entry", "yellow", [], { fix: analysisText("en").next.unreadableFix })), false);
  assert.equal(isPartialPlaceholder(check("env", "red", [], { fix: analysisText("en").partialFixToken })), false);
  const kept = fixFirstItems([check("next-entry", "yellow", [], { fix: "Commit a valid package.json" }), check("env", "yellow", [], { fix: analysisText("sv").partialFixRetry })]);
  assert.deepEqual(kept.map((item) => `${item.checkId} ${item.fix}`), ["next-entry Commit a valid package.json"]);
  // A placeholder-only report has no fix first list at all.
  assert.equal(renderFixFirst(fixFirstItems([check("env", "yellow", [], { fix: analysisText("en").partialFixToken })])), "");
});

test("long paths in fix first and since the previous scan get a break opportunity after every slash", () => {
  const items = fixFirstItems([check("imports", "red", [finding("src/components/account/Header.tsx", 12, "imports ./nav", "git add -- src/components/account/Nav.tsx")])]);
  const html = renderFixFirst(items);
  assert.match(html, /src\/<wbr\/>components\/<wbr\/>account\/<wbr\/>Header\.tsx:12/);
  assert.match(html, /<code>git add -- src\/<wbr\/>components\/<wbr\/>account\/<wbr\/>Nav\.tsx<\/code>/);
  const diff = diffReports(results([check("imports", "red", [])]), results([check("imports", "red", [finding("app/(shop)/cart/page.tsx", 2, "imports ./Gone")])]));
  const since = renderToStaticMarkup(createElement(SinceLastScan, { diff, previous: { id: "22222222-2222-4222-8222-222222222222", created_at: "2026-10-10T08:30:00.000Z" }, lang: "en" }));
  assert.match(since, /<code>app\/<wbr\/>\(shop\)\/<wbr\/>cart\/<wbr\/>page\.tsx:2<\/code>/);
});

test("the why it works locally line shows on failing cards and on review cards with findings, not on a partial scan", () => {
  assert.equal(showsLocalWhy(check("env", "red", [finding("app/a.ts", 1, "X is missing")])), true);
  // Older reports have no findings; a red card still explains itself.
  assert.equal(showsLocalWhy(check("env", "red", undefined)), true);
  assert.equal(showsLocalWhy(check("supabase", "yellow", [finding("supabase/migrations/1.sql", 5, "no grants")])), true);
  assert.equal(showsLocalWhy(check("env", "yellow", [])), false);
  assert.equal(showsLocalWhy(check("dependencies", "yellow", undefined)), false);
  assert.equal(showsLocalWhy(check("env", "green", [finding("app/a.ts", 1, "X is optional")])), false);
});

test("notes about next dev and the app folder are left off reports of another stack", () => {
  const env = check("env", "red", [finding("src/lib/db.ts", 1, "DATABASE_URL is missing")]);
  const entry = check("next-entry", "red", undefined);
  for (const nextApp of ["none", "nested"] as const) {
    assert.equal(showsLocalWhy(env, nextApp), false, nextApp);
    assert.equal(showsLocalWhy(entry, nextApp), false, nextApp);
    // Linux, lockfiles, a clean install and hardcoded keys hold for SvelteKit, Astro and Vite on Vercel too.
    for (const id of ["server-libs", "build-config", "dependencies", "secrets", "supabase", "prisma"] as const) {
      assert.equal(showsLocalWhy(check(id, "red", [finding("vercel.json", 1, "x")]), nextApp), true, `${id} ${nextApp}`);
    }
  }
  assert.equal(showsLocalWhy(env, "root"), true);
  // Older reports have no nextApp and keep every note.
  assert.equal(showsLocalWhy(env, undefined), true);
  assert.equal(showsLocalWhy(entry), true);
});

test("new report copy exists in both languages, explains every check and has no dashes or quotation marks", () => {
  const keys = ["report.fixFirstAll", "report.fixFirstFile", "report.copyCommand", "report.sinceTitle", "report.sinceLink", "report.sinceFixed",
    "report.sinceNew", "report.sinceMore", "report.sinceSame", "report.sinceStatusAria", "report.sincePartial", "report.sinceStatusOnly",
    "report.sinceSameShared", "report.sinceNotCompared", "report.localWhy", ...CHECK_IDS.map((id) => `report.localWhy.${id}` as const)] as const;
  for (const key of keys) {
    for (const lang of ["en", "sv"] as const) {
      assert.ok(messages[lang][key], `${lang} ${key}`);
      assert.doesNotMatch(messages[lang][key], /[–—"“”„]/, `${lang} ${key}`);
    }
  }
  assert.equal(CHECK_IDS.length, 9);
  assert.match(t("en", "report.localWhy.imports"), /macOS and Windows ignore letter case.*Linux/);
  assert.match(t("sv", "report.localWhy.imports"), /Linux/);
  // Two clauses joined by a conjunction, not a comma splice.
  assert.match(t("en", "report.localWhy.imports"), /file names, but Vercel builds on Linux, which does not\./);
  // The Swedish file line says complete, as the English does, and the card and the copied text agree with it.
  assert.equal(t("sv", "report.fixFirstFile", { path: ".env.example" }), "Committa den kompletta .env.example som visas i kontrollen.");
  assert.equal(t("sv", "report.completeFile", { path: ".env.example" }), "Komplett .env.example");
  assert.match(t("sv", "fix.completeFile", { path: ".env.example" }), /^Komplett \.env\.example/);
  assert.doesNotMatch(`${messages.sv["report.fixFirstFile"]} ${messages.sv["report.completeFile"]} ${messages.sv["fix.completeFile"]}`, /[Ff]ärdig/);
  assert.equal(t("en", "report.sinceFixed", { n: 3 }), "Fixed (3)");
  assert.equal(t("sv", "report.fixFirstAll", { n: 7 }), "Visa alla 7 punkter");
});
