import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import { promisify } from "node:util";
import { CLI_USER_AGENT_PREFIX, fromCli } from "../src/lib/cli-client";
import { t } from "../src/lib/i18n";
import { reportJson } from "../src/lib/report-json";
import { SITE_URL } from "../src/lib/site";
import type { CheckId, CheckResult, Finding, StoredReport } from "../src/types/report";

const root = join(__dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");
const bin = join(root, "cli", "bin.mjs");
const pkg = JSON.parse(read("cli/package.json")) as Record<string, unknown> & { version: string };

const SITE = SITE_URL;
const ID = "11111111-1111-4111-8111-111111111111";
// The fake API answers with reportJson() on a stored report, exactly as the route does, so a renamed field fails here
// before the real CLI prints undefined or crashes in its table.
const check = (id: CheckId, title: string, status: CheckResult["status"], findings: Finding[] = []): CheckResult =>
  ({ id, title, status, explanation: `${title} explained.`, fix: `${title} fix.`, evidence: [], findings });
const report = (repo: string, checks: CheckResult[]) => {
  const count = (status: CheckResult["status"]) => checks.filter((item) => item.status === status).length;
  const summary = { red: count("red"), yellow: count("yellow"), green: count("green") };
  const [owner, name] = repo.split("/");
  const stored: StoredReport = { id: ID, repo_url: `https://github.com/${repo}`, created_at: "2026-10-24T10:00:00.000Z", results: {
    repository: { owner, name, defaultBranch: "main", commitSha: "0123456789abcdef0123" }, checkedAt: "2026-10-24T10:00:00.000Z",
    scan: { filesInTree: 40, sourceFilesRead: 12, sourceFilesFound: 12, partial: false },
    summary, overall: summary.red ? "red" : summary.yellow ? "yellow" : "green", checks } };
  return reportJson(stored);
};
const WEB = report("acme/web", [
  check("imports", "Broken imports", "red", [{ file: "src/app/page.tsx", line: 12, problem: "Case mismatch.", fix: "Rename the import." }, { file: "src/x.ts", line: 1, problem: "p", fix: "f" }]),
  check("env", "Environment variables", "yellow", [{ file: "src/lib/db.ts", line: 3, problem: "No fallback.", fix: "Document it." }]),
  check("server-libs", "Vercel-incompatible server code", "green"),
]);
const CLEAN = report("acme/clean", [check("next-entry", "Next.js entrypoint", "green"), check("dependencies", "Dependencies", "green")]);
// Well past the 64 KB pipe buffer, so a --json answer cut short by process.exit shows up as invalid JSON.
const HUGE = report("acme/huge", [check("imports", "Broken imports", "red", Array.from({ length: 700 }, (_, index) =>
  ({ file: `src/components/widget-${index}.tsx`, line: index + 1, problem: `Import ${index} only resolves on a case-insensitive file system.`, fix: "Match the file name on disk." })))]);

type Seen = { headers: IncomingHttpHeaders; body: Record<string, unknown> };
const seen: Seen[] = [];
const server = createServer((request, response) => {
  let raw = "";
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", () => {
    const body = JSON.parse(raw) as Record<string, unknown>;
    seen.push({ headers: request.headers, body });
    const json = (status: number, data: unknown) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(data)); };
    if (request.method !== "POST" || request.url !== "/api/reports") return json(404, { error: "no such route" });
    switch (body.repoUrl) {
      case "https://github.com/acme/web": return json(201, WEB);
      case "https://github.com/acme/clean": return json(201, CLEAN);
      case "https://github.com/acme/from-git": return json(201, CLEAN);
      case "https://github.com/acme/huge": return json(201, HUGE);
      case "https://github.com/acme/limit": return json(429, { error: "You have used today's free scan. Get 24 hours for $2 and scan again right away.", paywall: true,
        resetsAt: "2026-10-25T00:00:00.000Z", pricingUrl: `${SITE}/pricing` });
      case "https://github.com/acme/private": return json(402, { error: "Private repos need a pass.", paywall: true, privateRepo: true });
      // The route's two other answers the CLI can meet: a token whose pass lapsed (402, no privateRepo) and a repository GitHub
      // cannot see without a pass (404 with privateRepo).
      case "https://github.com/acme/lapsed": return json(402, { error: t("en", "err.tokenPlan"), paywall: true, pricingUrl: `${SITE}/pricing` });
      case "https://github.com/acme/unseen": return json(404, { error: t("en", "gh.maybePrivate"), paywall: true, privateRepo: true });
      case "https://github.com/acme/broken": return json(500, { error: "Could not save the report." });
      case "https://github.com/acme/html": response.writeHead(502, { "content-type": "text/html" }); return response.end("<html>bad gateway</html>");
      default: return json(404, { error: "Repository not found; make sure it is public and the URL is correct." });
    }
  });
});
let api = "";
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

// Asynchronous on purpose: the fake API runs in this process, so a blocking spawn could never be answered.
// pipe: through a real pipe into cat, the way a shell pipeline reads the JSON. execFile's own stdio is a socket pair with a far
// larger buffer than a pipe's 64 KB, which would hide an answer cut short by process.exit; the exit code then travels on stderr.
async function run(args: string[], options: { cwd?: string; env?: Record<string, string>; pipe?: boolean } = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...options.env };
  if (!options.env?.DEPLOYDOCTOR_TOKEN) delete env.DEPLOYDOCTOR_TOKEN;
  const [file, argv]: [string, string[]] = options.pipe
    ? ["sh", ["-c", '{ "$0" "$@"; echo "exit=$?" >&2; } | cat', process.execPath, bin, ...args]]
    : [process.execPath, [bin, ...args]];
  const exitCode = (stderr: string, fallback: number | string | null) => (options.pipe ? Number(/^exit=(\d+)$/m.exec(stderr)?.[1]) : fallback);
  try {
    const { stdout, stderr } = await promisify(execFile)(file, argv, { cwd: options.cwd ?? root, env, encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    return { code: exitCode(stderr, 0), stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number | string | null; stdout?: string; stderr?: string };
    return { code: exitCode(failed.stderr ?? "", failed.code ?? null), stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}
const last = () => seen[seen.length - 1];
const hasGit = (() => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();

test("cli: prints one table row per check with the first finding, the report link, and exits 1 on a red check", async () => {
  const { code, stdout, stderr } = await run(["acme/web", "--api", `${api}/`]);
  assert.equal(code, 1, stderr);
  assert.match(stdout, /^Status\s+Check\s+Where$/m);
  assert.match(stdout, /^Fail\s+Broken imports\s+src\/app\/page\.tsx:12$/m);
  assert.match(stdout, /^Review\s+Environment variables\s+src\/lib\/db\.ts:3$/m);
  assert.match(stdout, /^Pass\s+Vercel-incompatible server code$/m);
  assert.match(stdout, /^DeployDoctor: acme\/web @ main 01234567$/m);
  assert.match(stdout, /1 failed, 1 to review, 1 passed\./);
  assert.match(stdout, new RegExp(`^Report: ${SITE}/r/${ID}$`, "m"));
  assert.match(stdout, /Free scans: 1 a day per IP\. Nothing was cloned or executed on this machine\./);
  // Piped output carries no ANSI colors, no dashes and no quotation marks.
  assert.doesNotMatch(stdout + stderr, /\u001b\[|[–—"]/);
  const { headers, body } = last();
  assert.ok(String(headers["user-agent"]).startsWith(`${CLI_USER_AGENT_PREFIX}${pkg.version}`), String(headers["user-agent"]));
  assert.equal(headers.origin, undefined);
  assert.equal(headers.authorization, undefined);
  assert.equal(headers["content-type"], "application/json");
  assert.deepEqual(body, { repoUrl: "https://github.com/acme/web" });
});

test("cli: a clean repository exits 0, a github.com URL is normalised and --checks is forwarded", async () => {
  const { code, stdout } = await run(["https://github.com/acme/clean.git", "--checks", "next,vercel", "--api", api]);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /^Pass\s+Next\.js entrypoint$/m);
  assert.match(stdout, /0 failed, 0 to review, 2 passed\./);
  assert.deepEqual(last().body, { repoUrl: "https://github.com/acme/clean", checks: ["next", "vercel"] });
  const before = seen.length;
  const bad = await run(["acme/clean", "--checks=nope", "--api", api]);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /next, vercel, env, supabase, prisma/);
  assert.equal(seen.length, before, "an invalid --checks never reaches the API");
});

test("cli: --json prints the raw answer and keeps the exit code", async () => {
  const { code, stdout } = await run(["acme/web", "--json", "--api", api]);
  assert.equal(code, 1);
  assert.deepEqual(JSON.parse(stdout), WEB);
  const limit = await run(["acme/limit", "--json", "--api", api]);
  assert.equal(limit.code, 2);
  assert.equal(JSON.parse(limit.stdout).paywall, true);
});

test("cli: --json through a real pipe arrives whole, also when the report is larger than the pipe buffer", { skip: process.platform === "win32" && "needs sh and cat" }, async () => {
  // The CLI leaves the exit code to Node instead of calling process.exit after the write, which drops what did not fit the pipe.
  assert.ok(JSON.stringify(HUGE).length > 65_536, "the fixture must exceed the 64 KB pipe buffer");
  const huge = await run(["acme/huge", "--json", "--api", api], { pipe: true });
  assert.equal(huge.code, 1, huge.stderr);
  assert.deepEqual(JSON.parse(huge.stdout), HUGE);
  // The error body in --json mode takes the same path.
  const limit = await run(["acme/limit", "--json", "--api", api], { pipe: true });
  assert.equal(limit.code, 2, limit.stderr);
  assert.equal(JSON.parse(limit.stdout).paywall, true);
});

test("cli: the free daily limit names the allowance, the pricing link from the answer and the token, exit 2", async () => {
  const { code, stdout, stderr } = await run(["acme/limit", "--api", api]);
  assert.equal(code, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /^You have used today's free scan\./m);
  assert.match(stderr, /Free scans: 1 a day per IP, no account\./);
  assert.ok(stderr.includes(`Unlimited scans: ${SITE}/pricing`), stderr);
  assert.match(stderr, /create an API token under My scans and set DEPLOYDOCTOR_TOKEN/);
  assert.doesNotMatch(stderr, /[–—"]/);
});

test("cli: 402 for a private repository, API errors and a non-JSON answer all exit 2 with a reason", async () => {
  const priv = await run(["acme/private", "--api", api]);
  assert.equal(priv.code, 2);
  assert.match(priv.stderr, /^Private repos need a pass\./m);
  // Without a pricingUrl in the answer the link is built from the API base.
  assert.ok(priv.stderr.includes(`Private repositories need a pass: ${api}/pricing`), priv.stderr);
  // privateRepo decides, not the status: GitHub could not see the repository and the route answered 404.
  const unseen = await run(["acme/unseen", "--api", api]);
  assert.equal(unseen.code, 2);
  assert.ok(unseen.stderr.includes(`Private repositories need a pass: ${api}/pricing`), unseen.stderr);
  // A 402 without privateRepo is a token whose pass lapsed: the private repository sentence would send the user to the wrong fix.
  const lapsed = await run(["acme/lapsed", "--api", api], { env: { DEPLOYDOCTOR_TOKEN: "ddt_old" } });
  assert.equal(lapsed.code, 2);
  assert.match(lapsed.stderr, /^API tokens work while a pass is active\./m);
  assert.doesNotMatch(lapsed.stderr, /Private repositor/);
  assert.ok(lapsed.stderr.includes(`No active pass for DEPLOYDOCTOR_TOKEN. Get one: ${SITE}/pricing`), lapsed.stderr);
  assert.match(lapsed.stderr, /My scans/);
  assert.doesNotMatch(lapsed.stderr, /[–—"]/);
  const broken = await run(["acme/broken", "--api", api]);
  assert.equal(broken.code, 2);
  assert.match(broken.stderr, /DeployDoctor returned 500: Could not save the report\./);
  const missing = await run(["acme/missing", "--api", api]);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /404: Repository not found/);
  const html = await run(["acme/html", "--api", api]);
  assert.equal(html.code, 2);
  assert.match(html.stderr, /returned 502 with an unexpected answer/);
  const offline = await run(["acme/web", "--api", "http://127.0.0.1:1"]);
  assert.equal(offline.code, 2);
  assert.match(offline.stderr, /DeployDoctor did not answer at http:\/\/127\.0\.0\.1:1/);
});

test("cli: resolves the repository from the git origin, otherwise prints a one-line hint and exits 2", { skip: !hasGit && "git is not installed" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "dd-cli-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", "git@github.com:acme/from-git.git"], { cwd: dir });
  const { code, stdout } = await run(["--api", api], { cwd: dir });
  assert.equal(code, 0, stdout);
  assert.deepEqual(last().body, { repoUrl: "https://github.com/acme/from-git" });
  execFileSync("git", ["remote", "set-url", "origin", "https://github.com/acme/from-git.git"], { cwd: dir });
  assert.equal((await run(["--api", api], { cwd: dir })).code, 0);
  assert.deepEqual(last().body, { repoUrl: "https://github.com/acme/from-git" });
  const before = seen.length;
  const none = await run(["--api", api], { cwd: mkdtempSync(join(tmpdir(), "dd-cli-none-")) });
  assert.equal(none.code, 2);
  assert.equal(none.stderr.trim().split("\n").length, 1);
  assert.match(none.stderr, /No repository given and no GitHub origin in this folder\. Try: npx deploydoctor owner\/repo/);
  const other = await run(["https://gitlab.com/acme/web", "--api", api]);
  assert.equal(other.code, 2);
  assert.match(other.stderr, /pass owner\/repo or a github\.com URL/);
  const unknown = await run(["acme/web", "--nope", "--api", api]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /Unknown option --nope/);
  assert.equal(seen.length, before, "usage errors never reach the API");
  assert.equal((await run(["--help"])).code, 0);
  assert.equal((await run(["--version"])).stdout.trim(), pkg.version);
});

test("cli: DEPLOYDOCTOR_TOKEN is sent as a bearer token", async () => {
  const { code, stdout } = await run(["acme/clean", "--api", api], { env: { DEPLOYDOCTOR_TOKEN: "ddt_test" } });
  assert.equal(code, 0);
  assert.equal(last().headers.authorization, "Bearer ddt_test");
  assert.doesNotMatch(stdout, /Free scans/);
});

test("cli package: zero dependencies, the published shape and matching docs", () => {
  assert.equal(pkg.name, "deploydoctor");
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.type, "module");
  assert.deepEqual(pkg.bin, { deploydoctor: "./bin.mjs" });
  assert.deepEqual(pkg.engines, { node: ">=20" });
  assert.equal(pkg.license, "BUSL-1.1");
  assert.match((pkg.repository as { url: string }).url, /github\.com\/jonjys\/deploydoctor/);
  assert.match(pkg.homepage as string, /^https:\/\/deploydoctor\.nyttolabs\.com/);
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "bundledDependencies"]) assert.equal(pkg[field], undefined, field);
  assert.ok((pkg.files as string[]).includes("bin.mjs"));
  assert.equal(read("cli/LICENSE"), read("LICENSE"));
  const source = read("cli/bin.mjs");
  assert.ok(source.startsWith("#!/usr/bin/env node\n"));
  for (const [, specifier] of source.matchAll(/^import .* from "([^"]+)";$/gm)) assert.ok(specifier.startsWith("node:"), specifier);
  assert.doesNotMatch(source, /\brequire\(|import\(/);
  // Colors only on a TTY, and only the plain bold, red, yellow and green codes.
  assert.match(source, /process\.stdout\.isTTY/);
  assert.deepEqual([...source.matchAll(/code: (\d+)/g)].map((match) => match[1]).sort(), ["31", "32", "33"]);
  const readme = read("cli/README.md");
  assert.match(readme, /npx deploydoctor/);
  assert.match(readme, /1 scan a day per IP/);
  assert.match(readme, /npm publish --access public/);
  assert.match(readme, /nothing is cloned/i);
  for (const file of ["cli/README.md", "cli/bin.mjs"]) assert.doesNotMatch(read(file), /[–—“”]/, file);
  // The usage text is visitor copy too: no quotation marks, no dashes.
  const usage = /const USAGE = `([^`]*)`/.exec(source)?.[1] ?? "";
  assert.match(usage, /^Usage: npx deploydoctor/);
  assert.doesNotMatch(usage, /["\u2013\u2014]/);
  // The npx one-liner enters the public docs only once the package is on npm: an unregistered name could be taken by anyone and
  // run on every visitor who follows the instruction. The Publishing section of cli/README.md carries the notice until then.
  const unpublished = /not published yet/.test(readme);
  for (const file of ["README.md", "src/app/ci/page.tsx"]) {
    if (unpublished) assert.doesNotMatch(read(file), /npx deploydoctor/, `${file} advertises npx deploydoctor before the package is on npm`);
    else assert.match(read(file), /npx deploydoctor/, `${file} should show the published one-liner`);
  }
  if (unpublished) assert.match(read("README.md"), /node cli\/bin\.mjs/, "the README says how to run the CLI from a checkout meanwhile");
});

test("reports route: the CLI allowance never matches a browser and keeps the daily limit and the paywall", () => {
  const request = (headers: Record<string, string>) => new Request(`${SITE}/api/reports`, { method: "POST", headers });
  assert.equal(fromCli(request({ "user-agent": "deploydoctor-cli/0.1.0" })), true);
  assert.equal(fromCli(request({ "user-agent": "deploydoctor-cli/0.1.0", "content-type": "application/json" })), true);
  // A browser always sends Origin on a POST, so a page that could set the user-agent still fails.
  assert.equal(fromCli(request({ "user-agent": "deploydoctor-cli/0.1.0", origin: SITE })), false);
  assert.equal(fromCli(request({ "user-agent": "deploydoctor-cli/0.1.0", origin: "null" })), false);
  assert.equal(fromCli(request({ "user-agent": "deploydoctor-cli/0.1.0", origin: "https://evil.example" })), false);
  assert.equal(fromCli(request({ "user-agent": "deploydoctor-cli" })), false);
  assert.equal(fromCli(request({ "user-agent": "deploydoctor-action" })), false);
  assert.equal(fromCli(request({ "user-agent": "Mozilla/5.0 (X11; Linux x86_64) deploydoctor-cli/0.1.0" })), false);
  assert.equal(fromCli(request({})), false);
  const route = read("src/app/api/reports/route.ts");
  assert.match(route, /const viaCli = !viaCi && fromCli\(request\);/);
  assert.match(route, /if \(!viaCi && !viaCli && !sameOrigin\(request\)\) return Response\.json\(\{ error: t\(lang, "err\.origin"\) \}, \{ status: 403 \}\);/);
  // The CLI gets the report as JSON like CI, but reserves a free scan like the website: viaCli appears nowhere near the plan or quota.
  assert.match(route, /if \(viaCi \|\| viaCli\) return Response\.json\(reportJson\(report\), \{ status: 201/);
  assert.match(route, /if \(!plan\) \{\s+const allowance = scanAllowance\(oidcRepo\);\s+const quota = await reserveScan\(request, allowance\);/);
  // The daily limit answer carries the pricing link the CLI prints.
  assert.match(route, /paywall: true, resetsAt: quota\.resetsAt, pricingUrl: `\$\{SITE_URL\}\/pricing` \}, \{ status: 429/);
  // Nothing answers a CORS preflight for the API, so a page cannot send the custom user-agent cross-site.
  assert.doesNotMatch(route, /OPTIONS|Access-Control-Allow/);
  assert.doesNotMatch(read("next.config.ts"), /Access-Control-Allow/);
});
