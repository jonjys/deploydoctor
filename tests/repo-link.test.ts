import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import test from "node:test";
import { repoFromPath } from "../src/lib/repo-link";
import { GET, POST } from "../src/app/[owner]/[repo]/[[...rest]]/route";

const repo = (path: string) => repoFromPath(path.split("/").filter(Boolean));

test("a repo path, with or without a pasted github.com prefix, gives owner/name", () => {
  assert.equal(repo("/vercel/commerce"), "vercel/commerce");
  assert.equal(repo("/github.com/vercel/commerce"), "vercel/commerce");
  assert.equal(repo("/www.github.com/vercel/commerce"), "vercel/commerce");
  assert.equal(repo("/GitHub.com/Vercel/Commerce"), "Vercel/Commerce");
  // Next.js collapses the double slash of a pasted https://github.com/... to one.
  assert.equal(repo("/https:/github.com/vercel/commerce"), "vercel/commerce");
  assert.equal(repo("/vercel/next.js"), "vercel/next.js");
  assert.equal(repo("/octo-org/.github"), "octo-org/.github");
  assert.equal(repo("/acme_corp/app_v2"), "acme_corp/app_v2");
});

test(".git and anything after the repository are dropped", () => {
  assert.equal(repo("/vercel/commerce.git"), "vercel/commerce");
  assert.equal(repo("/vercel/commerce/tree/main"), "vercel/commerce");
  assert.equal(repo("/vercel/commerce/tree/feature/x/y"), "vercel/commerce");
  assert.equal(repo("/vercel/commerce/blob/main/app/page.tsx"), "vercel/commerce");
  assert.equal(repo("/vercel/commerce/pulls"), "vercel/commerce");
  assert.equal(repo("/github.com/vercel/commerce/issues/12"), "vercel/commerce");
});

test("paths that do not name a repository are rejected", () => {
  assert.equal(repo("/vercel"), null);
  assert.equal(repo("/github.com/vercel"), null);
  assert.equal(repo("/vercel/.git"), null);
  assert.equal(repo("/vercel/.."), null);
  assert.equal(repo("/vercel/com merce"), null);
  assert.equal(repo("/vercel/<script>"), null);
  assert.equal(repo(`/vercel/${"a".repeat(101)}`), null);
  assert.equal(repo(`/${"a".repeat(40)}/commerce`), null);
  assert.equal(repo("/-vercel/commerce"), null);
  // Dots and a leading underscore never start a GitHub login, which keeps files and framework paths out.
  assert.equal(repo("/gitlab.com/vercel/commerce"), null);
  assert.equal(repo("/https:/gitlab.com/vercel/commerce"), null);
  assert.equal(repo("/.well-known/appspecific/com.chrome.devtools.json"), null);
  assert.equal(repo("/_next/static/chunks/app.js"), null);
  assert.equal(repo("/favicon.ico/x"), null);
  assert.equal(repo("/og.png/x"), null);
  assert.equal(repo("/robots.txt/x"), null);
  assert.equal(repo("/sitemap.xml/x"), null);
  assert.equal(repo("/llms.txt/x"), null);
  // GitHub's own pages are not repositories.
  assert.equal(repo("/orgs/vercel/repositories"), null);
  assert.equal(repo("/github.com/settings/tokens"), null);
  assert.equal(repo("/marketplace/actions/checkout"), null);
});

test("every top-level route of the app stays its own, so unknown paths under it still 404", () => {
  const appDir = new URL("../src/app/", import.meta.url);
  const routes = readdirSync(appDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("[") && !entry.name.startsWith("("))
    .map((entry) => entry.name);
  assert.ok(routes.includes("r") && routes.includes("api") && routes.includes("guides"));
  for (const route of routes) {
    assert.equal(repo(`/${route}/x/y`), null, route);
    assert.equal(repo(`/${route.toUpperCase()}/x`), null, route);
  }
  assert.equal(repo("/r/000fd3a4-4fa8-4e01-93d7-9dc2b29d6c67/badge"), null);
  assert.equal(repo("/api/health/stripe"), null);
  assert.equal(repo("/patch/success/x"), null);
  // Public files have a single segment, so they never reach the [owner]/[repo] route at all.
  for (const file of readdirSync(new URL("../public/", import.meta.url))) assert.equal(repo(`/${file}`), null, file);
});

test("the route sends a repo link to the home page scan and 404s anything else", async () => {
  const call = (path: string) => {
    const [owner, repoName, ...rest] = path.split("/").filter(Boolean);
    const params = Promise.resolve({ owner, repo: repoName, rest: rest.length ? rest : undefined });
    return GET(new Request(`https://deploydoctor.example${path}`), { params });
  };
  for (const path of ["/vercel/commerce", "/github.com/vercel/commerce", "/vercel/commerce/tree/main", "/vercel/commerce.git"]) {
    const response = await call(path);
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get("location"), "https://deploydoctor.example/?repo=vercel/commerce", path);
  }
  assert.equal((await call("/api/a/b/c")).status, 404);
  assert.equal((await call("/a.b/c/d")).status, 404);
  assert.equal(POST().status, 404);
});
