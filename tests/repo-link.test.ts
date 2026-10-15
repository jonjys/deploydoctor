import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { NOT_FOUND_PATH, repoFromPath } from "../src/lib/repo-link";
import { GET, POST } from "../src/app/[owner]/[repo]/[[...rest]]/route";

const repo = (path: string) => repoFromPath(path.split("/").filter(Boolean));
const root = fileURLToPath(new URL("..", import.meta.url));

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
  assert.equal(repo("/vercel/commerce.git.git"), "vercel/commerce");
  assert.equal(repo("/vercel/commerce.GIT.git/tree/main"), "vercel/commerce");
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
  assert.equal(repo("/vercel/.git.git"), null);
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
  for (const page of ["stars", "enterprise", "solutions", "security", "customer-stories", "features", "pricing", "sponsors",
    "topics", "collections", "trending", "marketplace", "settings", "notifications", "orgs", "login", "signup", "explore",
    "about", "readme", "site", "contact", "apps", "search"]) {
    assert.equal(repo(`/${page}/x`), null, page);
    assert.equal(repo(`/github.com/${page}/x/y`), null, page);
  }
});

test("every top-level route of the app stays its own, so unknown paths under it get the not-found page", () => {
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
});

// Public files are served before any route, but a path below one (/og.png/x) or a missing file in a public folder
// (/images/gone.png) still reaches the [owner]/[repo] route, so neither may start a scan.
const publicFiles = readdirSync(join(root, "public"), { recursive: true, encoding: "utf8" })
  .filter((file) => statSync(join(root, "public", file)).isFile());

test("paths under public files and folders never read as a repository", () => {
  assert.ok(publicFiles.includes("og.png"));
  for (const file of publicFiles) {
    const segments = file.split(sep);
    assert.equal(repoFromPath([...segments, "x"]), null, file);
    assert.equal(repoFromPath([segments[0], "gone.png"]), null, file);
  }
});

test("the not-found redirect lands on a path that no route or public file serves", () => {
  assert.match(NOT_FOUND_PATH, /^\/[^/]+$/);
  const segment = NOT_FOUND_PATH.slice(1);
  assert.ok(!existsSync(join(root, "src", "app", segment)));
  assert.ok(!existsSync(join(root, "public", segment)));
  // One segment only reaches [owner], which has no page or route of its own, so the root not-found page renders.
  assert.deepEqual(readdirSync(join(root, "src", "app", "[owner]")), ["[repo]"]);
  assert.ok(existsSync(join(root, "src", "app", "not-found.tsx")));
});

test("the route sends a repo link to the home page scan and anything else to the not-found page", async () => {
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
  for (const path of ["/api/a/b/c", "/a.b/c/d", "/orgs/vercel/repositories", "/stars/x/y", "/github.com/security/advisories",
    "/vercel/.git.git", ...publicFiles.map((file) => `/${file.split(sep).join("/")}/x`)]) {
    const response = await call(path);
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get("location"), `https://deploydoctor.example${NOT_FOUND_PATH}`, path);
  }
  // Other methods keep a plain 404.
  assert.equal(POST().status, 404);
});
