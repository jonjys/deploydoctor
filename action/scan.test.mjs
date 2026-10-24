import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scan = fileURLToPath(new URL("./scan.mjs", import.meta.url));

function run(status, data, paid = false, extraEnv = {}) {
  const mock = `globalThis.fetch = async (url) => String(url).startsWith("https://oidc.example/")
    ? Response.json({value:"fixture-oidc"})
    : Response.json(${JSON.stringify(data)}, {status:${status}});`;
  return spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(mock)}`, scan], {
    encoding: "utf8",
    env: {
      ...process.env,
      DD_REPOSITORY: "acme/site",
      DD_REF: "a".repeat(40),
      DD_API_URL: "https://deploydoctor.example",
      DD_TOKEN: paid ? "fixture-api-token" : "",
      DD_GITHUB_TOKEN: "",
      DD_FAIL_ON: "red",
      GITHUB_OUTPUT: "",
      GITHUB_STEP_SUMMARY: "",
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.example/?request=fixture",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "fixture-request-token",
      ...extraEnv,
    },
    timeout: 10_000,
  });
}

test("free daily quota exhaustion warns without blocking the pull request", () => {
  const result = run(429, { paywall: true, error: "One free scan used" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /::warning::/);
  assert.doesNotMatch(result.stdout, /::error::/);
});

test("a used free scan is written to the job summary with the pricing link", () => {
  const summaryFile = join(mkdtempSync(join(tmpdir(), "deploydoctor-scan-")), "summary.md");
  writeFileSync(summaryFile, "");
  const result = run(429, { paywall: true, error: "One free scan used" }, false, { GITHUB_STEP_SUMMARY: summaryFile });
  assert.equal(result.status, 0, result.stderr);
  const sentence = "DeployDoctor: today's free scan for acme/site is used (One free scan used). Unlimited scans: https://deploydoctor.example/pricing";
  assert.equal(readFileSync(summaryFile, "utf8"), `${sentence}\n`);
  assert.ok(result.stdout.includes(`::warning::${sentence}`), result.stdout);
});

test("quota-exhausted: fail turns a used free scan into a failed job, and other values are rejected", () => {
  const failed = run(429, { paywall: true, error: "One free scan used" }, false, { DD_QUOTA_EXHAUSTED: "fail" });
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stdout, /::error::DeployDoctor: today's free scan for acme\/site is used/);
  assert.doesNotMatch(failed.stdout, /::warning::/);
  // Spelled out as warn, the default behaviour stays.
  assert.equal(run(429, { paywall: true }, false, { DD_QUOTA_EXHAUSTED: "WARN" }).status, 0);
  const bad = run(429, { paywall: true }, false, { DD_QUOTA_EXHAUSTED: "sometimes" });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /::error::Input `quota-exhausted` must be warn or fail/);
});

test("the action declares quota-exhausted and this repository's dogfood job fails on a used free scan", () => {
  const actionYml = readFileSync(new URL("./action.yml", import.meta.url), "utf8");
  assert.match(actionYml, /^  quota-exhausted:\n    description: .*\n    required: false\n    default: warn$/m);
  assert.match(actionYml, /DD_QUOTA_EXHAUSTED: \$\{\{ inputs\.quota-exhausted \}\}/);
  assert.match(readFileSync(new URL("./README.md", import.meta.url), "utf8"), /\| `quota-exhausted` \| `warn` \|/);
  const workflow = readFileSync(new URL("../.github/workflows/deploydoctor.yml", import.meta.url), "utf8");
  assert.match(workflow, /uses: \.\/action\n\s+with:\n\s+quota-exhausted: fail/);
});

test("GitHub rate limiting and capacity failures are not mistaken for a free quota", () => {
  for (const data of [{ error: "GitHub rate limit" }, { paywall: false, error: "Scanner busy" }]) {
    const result = run(429, data);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /::error::DeployDoctor returned 429/);
    assert.doesNotMatch(result.stdout, /::warning::/);
  }
});

test("paid requests cannot silently skip payment or capacity failures", () => {
  for (const status of [401, 402, 429]) {
    const result = run(status, { paywall: true, error: "Rejected" }, true);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, new RegExp(`::error::DeployDoctor returned ${status}`));
  }
});

test("successful scans still report results and red findings fail the job", () => {
  for (const red of [0, 1]) {
    const result = run(201, {
      overall: red ? "red" : "green", ref: "a".repeat(40),
      url: "https://deploydoctor.example/r/fixture",
      summary: { red, yellow: 0, green: 1 - red }, checks: [],
    });
    assert.equal(result.status, red, result.stderr);
    assert.match(result.stdout, /https:\/\/deploydoctor.example\/r\/fixture/);
  }
});
