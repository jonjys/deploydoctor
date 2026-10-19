import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { diagnoseAllowance, FREE_ACTION_SCANS_PER_DAY, FREE_DIAGNOSES_PER_DAY, FREE_SCANS_PER_DAY, scanAllowance } from "../src/lib/limits";
import { handleDeployMcp } from "../src/lib/mcp";
import { messages, t, type MessageKey } from "../src/lib/i18n";
import { planPrice } from "../src/lib/plans";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const sourceFiles = (dir: string): string[] => readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : []);

test("free allowance: one website scan and one AI diagnosis per visitor, three Action scans per repository", () => {
  assert.equal(FREE_SCANS_PER_DAY, 1);
  assert.equal(FREE_DIAGNOSES_PER_DAY, 1);
  assert.equal(FREE_ACTION_SCANS_PER_DAY, 3);
  // A website scan counts against the visitor's IP hash, which reserveScan fills in when no key is given.
  assert.deepEqual(scanAllowance(null), { limit: FREE_SCANS_PER_DAY });
  // The Action keeps the repository key it always had, so today's count carries over the deploy.
  assert.deepEqual(scanAllowance("Acme/Site"), { key: "repo:acme/site", limit: FREE_ACTION_SCANS_PER_DAY });
  assert.deepEqual(diagnoseAllowance("abc123"), { key: "diagnose:abc123", limit: FREE_DIAGNOSES_PER_DAY });
  for (const limit of [FREE_SCANS_PER_DAY, FREE_DIAGNOSES_PER_DAY, FREE_ACTION_SCANS_PER_DAY]) assert.ok(Number.isInteger(limit) && limit >= 1 && limit <= 100);
});

test("free allowance: each route reserves with its own limit, and only those routes reserve", () => {
  const reports = read("src/app/api/reports/route.ts");
  assert.match(reports, /const allowance = scanAllowance\(oidcRepo\);\s+const quota = await reserveScan\(request, allowance\);/);
  // The Action's limit message names that repository's allowance, not the visitor's one free scan.
  assert.match(reports, /oidcRepo \? t\(lang, "err\.actionLimit", \{ n: allowance\.limit \}\) : t\(lang, "err\.dailyLimit"\)/);
  assert.match(read("src/app/api/diagnose/route.ts"), /reserveScan\(request, diagnoseAllowance\(hashRequestIp\(request\)\)\)/);
  // /api/scan and the MCP plugin scan through the reports handler; stack detection never reserves.
  assert.match(read("src/app/api/scan/route.ts"), /export \{ POST \} from "\.\.\/reports\/route";/);
  assert.match(read("src/app/api/mcp/route.ts"), /import \{ POST as scan \} from "\.\.\/reports\/route";/);
  const callers = sourceFiles("src").filter((file) => /reserveScan\(/.test(read(file)) && !file.endsWith(join("lib", "access.ts")));
  assert.deepEqual(callers.sort(), [join("src", "app", "api", "diagnose", "route.ts"), join("src", "app", "api", "reports", "route.ts")]);
  assert.match(read("src/lib/access.ts"), /p_id: id, p_limit: limit,/);
});

test("free allowance: the migration only adds a limited reserve function and leaves reserve_scan and finish_scan alone", () => {
  const dir = "supabase/migrations";
  const files = readdirSync(join(root, dir)).sort();
  const latest = files.filter((file) => /function public\.reserve_scan_limited\(/.test(read(join(dir, file)))).at(-1);
  assert.equal(latest, "20261017090000_reserve_scan_limit.sql");
  assert.ok(latest > "20261012090000", "after the last applied migration");
  const sql = read(join(dir, latest)).replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /\b(?:drop|alter|truncate|delete)\b/i, "nothing existing is removed or changed");
  assert.match(sql, /create function public\.reserve_scan_limited\(p_ip_hash text, p_id uuid, p_limit integer\)/);
  assert.match(sql, /if p_limit is null or p_limit < 1 or p_limit > 3 then\s+raise exception/);
  assert.match(sql, /where public\.scan_limits\.scans < p_limit/);
  assert.match(sql, /'remaining', p_limit - coalesce\(v_count, p_limit\)/);
  assert.match(sql, /revoke all on function public\.reserve_scan_limited\(text, uuid, integer\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.reserve_scan_limited\(text, uuid, integer\) to service_role;/);
  assert.doesNotMatch(sql, /finish_scan|function public\.reserve_scan\(/);
  // Every allowance the app uses fits the function's range and the scan_limits cap of 3.
  for (const limit of [FREE_SCANS_PER_DAY, FREE_DIAGNOSES_PER_DAY, FREE_ACTION_SCANS_PER_DAY]) assert.ok(limit >= 1 && limit <= 3, String(limit));
  assert.match(read("src/lib/access.ts"), /rpc<[^>]+>\("reserve_scan_limited"/);
});

// Website wording for the old allowance, in either language.
const OLD_ALLOWANCE = /\b(?:3|three|tre)\s+(?:free\s+|gratis\s+)?(?:public\s+|publika\s+)?(?:scans|skanningar|diagnoses|diagnoser)\b|today's 3|dagens 3|(?:3|three)-free-scans|three scans\/day/i;

test("free allowance copy: no visitor copy still offers 3 free scans or 3 free diagnoses", () => {
  for (const lang of ["en", "sv"] as const) {
    for (const [key, text] of Object.entries(messages[lang])) {
      // The Action keeps 3 per repository and fills in the number from its constant.
      if (key === "err.actionLimit") continue;
      assert.doesNotMatch(text, OLD_ALLOWANCE, `${lang} ${key}`);
    }
  }
  // Pages and docs that are not translated. The Action copy on /ci stays 3 a day per repository.
  for (const file of ["src/app/ai-plugin/page.tsx", "src/app/guides/page.tsx", "src/app/guides/[slug]/page.tsx", "src/lib/mcp.ts",
    "README.md", "plugins/deploydoctor/README.md", "plugins/deploydoctor/plugin.json", "public/llms.txt"]) {
    assert.doesNotMatch(read(file), OLD_ALLOWANCE, file);
  }
  const ci = read("src/app/ci/page.tsx");
  assert.doesNotMatch(ci, /Three free scans a day on the website/);
  assert.match(ci, /One free scan a day on the website and 3 a day for each public repository in the Action/);
  assert.match(ci, /Each public repository gets\s+3 free scans a day/);
  assert.equal(t("en", "err.actionLimit", { n: FREE_ACTION_SCANS_PER_DAY }).includes("today's 3 free Action scans"), true);
  assert.equal(t("sv", "err.actionLimit", { n: FREE_ACTION_SCANS_PER_DAY }).includes("dagens 3 gratis Action-skanningar"), true);
});

test("free allowance copy: the numbers match the limits and the $2 pass is the next step", () => {
  assert.equal(t("en", "home.trust.free"), `${FREE_SCANS_PER_DAY} free scan / day`);
  assert.equal(t("sv", "home.trust.free"), `${FREE_SCANS_PER_DAY} gratis skanning / dag`);
  assert.equal(t("en", "pricing.freeScans"), `${FREE_SCANS_PER_DAY} public scan / day`);
  assert.equal(t("sv", "pricing.freeScans"), `${FREE_SCANS_PER_DAY} publik skanning / dag`);
  assert.match(t("en", "pricing.freeDiag"), new RegExp(`^${FREE_DIAGNOSES_PER_DAY} AI build log diagnosis / day$`));
  assert.match(t("sv", "pricing.freeDiag"), new RegExp(`^${FREE_DIAGNOSES_PER_DAY} AI-diagnos av bygglogg / dag$`));
  assert.match(t("en", "account.noPlan"), /1 free scan and 1 free AI diagnosis a day/);
  assert.match(t("sv", "account.noPlan"), /1 gratis skanning och 1 gratis AI-diagnos per dag/);
  for (const lang of ["en", "sv"] as const) {
    assert.match(t(lang, "diag.sub"), /10/);
    assert.match(t(lang, "pricing.diag"), /10/);
    assert.match(t(lang, "pricing.capacity"), /10/);
    assert.doesNotMatch(t(lang, "pricing.diag"), /unlimited|obegränsat/i);
  }
  // The limit message says the free one is used and that the pass continues right away; the paywall below repeats it.
  assert.match(t("en", "err.dailyLimit"), /^You have used today's free scan\. Get 24 hours for \$2 and scan again right away/);
  assert.match(t("sv", "err.dailyLimit"), /^Du har använt dagens gratis skanning\. Köp 24 timmar för 19 kr och skanna igen direkt/);
  assert.match(t("en", "diag.limit"), /^You have used today's free diagnosis\. Get 24 hours for \$2 and diagnose again right away/);
  assert.match(t("sv", "diag.limit"), /^Du har använt dagens gratis diagnos\. Köp 24 timmar för 19 kr och diagnostisera igen direkt/);
  assert.equal(t("en", "paywall.title"), "Continue right away for $2");
  assert.equal(t("sv", "paywall.title"), "Fortsätt direkt för 19 kr");
  const changed: MessageKey[] = ["home.copy", "home.trust.free", "pricing.freeDiag", "err.actionLimit", "diag.sub", "diag.limit",
    "paywall.title", "paywall.body", "err.dailyLimit", "pricing.freeScans", "account.noPlan"];
  for (const key of changed) {
    for (const lang of ["en", "sv"] as const) {
      assert.ok(messages[lang][key], `${lang} ${key}`);
      assert.doesNotMatch(messages[lang][key], /[–—"“”„]/, `${lang} ${key}`);
    }
    // Dollars in English, the kronor guide in Swedish, never the other one.
    assert.doesNotMatch(t("en", key), /\bkr\b/, `en ${key}`);
    assert.doesNotMatch(t("sv", key), /\$/, `sv ${key}`);
  }
  for (const key of ["home.copy", "diag.sub", "diag.limit", "paywall.title", "err.dailyLimit", "account.noPlan", "err.actionLimit"] as const) {
    assert.ok(t("en", key).includes(planPrice("day", "en")), `en ${key}`);
    assert.ok(t("sv", key).includes(planPrice("day", "sv")), `sv ${key}`);
  }
});

test("free allowance: the MCP plugin reports the website's daily scan allowance", async () => {
  const fail = async () => { throw new Error("must-not-be-called"); };
  const base = "https://deploydoctor.nyttolabs.com";
  const rpc = async (method: string, params: unknown) => (await (await handleDeployMcp(new Request(`${base}/api/mcp`, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }), { scan: fail, report: fail }, base)).json()) as { result: { structuredContent: Record<string, unknown>; tools: { name: string; description: string }[] } };
  const plans = await rpc("tools/call", { name: "get_deploydoctor_plans", arguments: {} });
  assert.equal(plans.result.structuredContent.freeScansPerDay, FREE_SCANS_PER_DAY);
  const tools = await rpc("tools/list", {});
  assert.match(tools.result.tools.find((tool) => tool.name === "scan_public_repository")?.description ?? "", /free quota of 1 scan\/day per source IP/);
});
