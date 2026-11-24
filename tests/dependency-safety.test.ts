import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkDependencies, dependencyPackages, isMalware, teaser, typosquatOf } from "../src/lib/dependency-safety";
import { safetyRepoFromContext } from "../src/lib/checkout-guard";

const manifest = JSON.stringify({ dependencies: { express: "^4.19.0", "expres-utils": "1.0.0", expres: "1.0.0", preact: "^10.0.0" }, devDependencies: { esbuild: "^0.21.0" } });
const lockV3 = JSON.stringify({ lockfileVersion: 3, packages: {
  "": { name: "app" },
  "node_modules/express": { version: "4.19.2" },
  "node_modules/expres-utils": { version: "1.0.0", hasInstallScript: true },
  "node_modules/esbuild": { version: "0.21.5", dev: true, hasInstallScript: true },
  "node_modules/express/node_modules/debug": { version: "2.6.9" },
  "node_modules/flatmap-stream": { version: "0.1.1" },
  "node_modules/expres": { version: "1.0.0" },
  "node_modules/preact": { version: "10.24.0" },
  "node_modules/linked": { link: true },
} });

test("the lockfile gives the full tree, with direct, dev and install-script flags", () => {
  const { packages, lockfile } = dependencyPackages(manifest, lockV3);
  assert.equal(lockfile, true);
  assert.deepEqual(packages.map(p => `${p.name}@${p.version}${p.direct ? " direct" : ""}${p.installScript ? " install" : ""}`).sort(),
    ["debug@2.6.9", "esbuild@0.21.5 direct install", "expres-utils@1.0.0 direct install", "expres@1.0.0 direct", "express@4.19.2 direct", "flatmap-stream@0.1.1", "preact@10.24.0 direct"]);
  const v1 = dependencyPackages(manifest, JSON.stringify({ lockfileVersion: 1, dependencies: { express: { version: "4.19.2", dependencies: { debug: { version: "2.6.9" } } } } }));
  assert.deepEqual(v1.packages.map(p => p.name).sort(), ["debug", "express"]);
  const none = dependencyPackages(manifest, null);
  assert.equal(none.lockfile, false);
  assert.equal(none.packages.length, 5);
  assert.ok(none.packages.every(p => p.version === null && p.direct));
});

test("look-alike names are caught, real names are not", () => {
  assert.equal(typosquatOf("expres"), "express");
  assert.equal(typosquatOf("lodahs"), "lodash");
  assert.equal(typosquatOf("cross_env"), "cross-env");
  for (const real of ["express", "react-dom", "dotenv", "zod", "lodash.merge"]) assert.equal(typosquatOf(real), null, real);
});

test("known malware, advisories, unexpected install scripts and unused packages are reported; expected install steps are not", async () => {
  const { packages, ...meta } = dependencyPackages(manifest, lockV3);
  const fetcher = async (url: string) => {
    if (url.includes("/advisories/bulk")) return new Response(JSON.stringify({
      "flatmap-stream": [{ title: "Malicious Package in flatmap-stream", severity: "critical", url: "https://github.com/advisories/GHSA-9x64-5r7x-2q53" }],
      debug: [{ title: "Regular expression denial of service", severity: "low" }],
      express: [{ title: "Open redirect in express", severity: "high", url: "https://github.com/advisories/x" }],
    }));
    if (url.includes("api.npmjs.org/downloads")) return new Response(JSON.stringify({ "expres-utils": { downloads: 12 }, expres: { downloads: 40 }, preact: { downloads: 9000000 } }));
    return new Response("{}", { status: 404 });
  };
  const report = await checkDependencies(packages, meta, fetcher as typeof fetch);
  const kinds = report.findings.map(f => `${f.kind}:${f.package}`);
  assert.deepEqual(kinds.slice(0, 1), ["malware:flatmap-stream"]);
  for (const k of ["advisory:express", "install-script:expres-utils", "typosquat:expres", "low-downloads:expres-utils"]) assert.ok(kinds.includes(k), k);
  assert.ok(!kinds.some(k => k.endsWith(":preact")), "a near name with millions of downloads is not a look-alike");
  assert.ok(!kinds.some(k => k.endsWith(":esbuild")), "esbuild's install step is expected");
  assert.ok(!kinds.includes("advisory:debug"), "low advisories are not red flags");
  assert.equal(report.counts.critical, 1);
  assert.equal(report.total, 7);
  const locked = teaser(report);
  assert.equal(locked.locked, true);
  assert.ok(!("findings" in locked));
  assert.ok(!JSON.stringify(locked).includes("flatmap"), "no package name leaks to a visitor without a pass");
});

test("a pass bought from the dependency check returns the buyer to that repository", () => {
  assert.equal(safetyRepoFromContext("safety:pallets/flask"), "pallets/flask");
  assert.equal(safetyRepoFromContext("https://github.com/pallets/flask"), undefined);
  assert.equal(safetyRepoFromContext("safety:../etc"), undefined);
  const route = readFileSync(new URL("../src/app/api/repo-safety/route.ts", import.meta.url), "utf8");
  assert.match(route, /paid \? dependencies : teaser\(dependencies\)/);
});

test("malware means CWE-506 or a malware title, not a flaw that mentions a malicious website", () => {
  assert.equal(isMalware({ title: "Malicious Package in flatmap-stream", cwe: ["CWE-506"] }), true);
  assert.equal(isMalware({ title: "Embedded malware in ua-parser-js", cwe: ["CWE-506", "CWE-912"] }), true);
  assert.equal(isMalware({ title: "Malicious Package in x" }), true);
  assert.equal(isMalware({ title: "Vitest allows Remote Code Execution when accessing a malicious website", cwe: ["CWE-1385"] }), false);
});
