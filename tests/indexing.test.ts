import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import nextConfig from "../next.config";
import robots from "../src/app/robots";
import sitemap from "../src/app/sitemap";
import { isProductionDeployment, robotsPolicy, siteRobots, vercelAppHostGuard } from "../src/lib/indexing";
import { SITE_URL } from "../src/lib/site";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

function withEnv(value: string | undefined, run: () => void) {
  const previous = process.env.VERCEL_ENV;
  if (value === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
}

test("production robots.txt allows crawling and points at the sitemap", () => {
  withEnv("production", () => {
    assert.equal(isProductionDeployment(), true);
    assert.deepEqual(siteRobots(), { index: true, follow: true });
    const body = robots();
    assert.equal(body.sitemap, `${SITE_URL}/sitemap.xml`);
    assert.deepEqual(body, robotsPolicy(SITE_URL));
    const rules = body.rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;
    assert.equal(rule.userAgent, "*");
    assert.ok(([] as string[]).concat(rule.allow ?? []).includes("/"));
    const disallow = ([] as string[]).concat(rule.disallow ?? []);
    assert.deepEqual(disallow, ["/api/"]);
    for (const path of ["/", "/pricing", "/guides", "/errors", "/diagnose", "/r/example"]) {
      assert.ok(!disallow.some((prefix) => path.startsWith(prefix)), `${path} stays crawlable`);
    }
    const urls = sitemap().map((entry) => entry.url);
    assert.ok(urls.includes(`${SITE_URL}/`));
    assert.ok(urls.every((url) => !url.includes("/api/") && !url.includes("/r/")));
  });
});

test("preview deployments are noindex and robots.txt disallows crawling", () => {
  for (const env of ["preview", "development", undefined]) {
    withEnv(env, () => {
      assert.equal(isProductionDeployment(), false);
      assert.deepEqual(siteRobots(), { index: false, follow: false });
      const rules = robots().rules;
      const rule = Array.isArray(rules) ? rules[0] : rules;
      assert.deepEqual(([] as string[]).concat(rule.disallow ?? []), ["/"]);
      assert.equal(robots().sitemap, `${SITE_URL}/sitemap.xml`);
    });
  }
});

test("X-Robots-Tag noindex covers /api always and the whole host only outside production", async () => {
  const headersFor = async (env: string | undefined) => {
    const previous = process.env.VERCEL_ENV;
    if (env === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = env;
    try {
      return await nextConfig.headers!();
    } finally {
      if (previous === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = previous;
    }
  };
  const noindex = (rules: Awaited<ReturnType<NonNullable<typeof nextConfig.headers>>>, source: string) =>
    rules.find((rule) => rule.source === source)?.headers.some((header) => header.key === "X-Robots-Tag" && header.value === "noindex");

  const production = await headersFor("production");
  assert.equal(noindex(production, "/api/:path*"), true);
  assert.equal(production.some((rule) => rule.source === "/:path*" && !rule.has), false);
  const vercelHost = production.find((rule) => rule.source === "/:path*" && rule.has?.some((item) => item.type === "host"));
  assert.equal(vercelHost?.headers.some((header) => header.key === "X-Robots-Tag" && header.value === "noindex"), true);

  for (const env of ["preview", undefined]) {
    const rules = await headersFor(env);
    assert.equal(noindex(rules, "/:path*"), true);
    assert.equal(noindex(rules, "/api/:path*"), true);
  }
});

test("production *.vercel.app hosts redirect to the canonical site and stay noindex", async () => {
  const previous = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "production";
  try {
    const guard = vercelAppHostGuard(SITE_URL);
    assert.equal(guard.redirects[0]?.destination, `${SITE_URL}/:path*`);
    assert.equal(guard.redirects[0]?.permanent, true);
    assert.match(String(guard.redirects[0]?.has[0]?.value), /vercel\\\.app/);
    assert.equal(guard.headers[0]?.headers[0]?.value, "noindex");
    const redirects = await nextConfig.redirects!();
    assert.ok(redirects.some((rule) => rule.destination === `${SITE_URL}/:path*`));
    assert.ok(redirects.some((rule) => rule.source === "/partner"));
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
  process.env.VERCEL_ENV = "preview";
  try {
    assert.deepEqual(vercelAppHostGuard(SITE_URL), { redirects: [], headers: [] });
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
});

test("every report stays noindex, the deactivated audit stays unpublished, and Deploy Rescue is a static new-tab link", () => {
  const report = read("src/app/r/[id]/page.tsx");
  assert.match(report, /robots: privateNoindex/);
  assert.doesNotMatch(report, /is_private \? \{ robots: privateNoindex \}/);
  assert.doesNotMatch(report, /robots: \{ index: false, follow: false \}/);

  const page = read("src/app/page.tsx");
  const deadAudit = /buy\.stripe\.com\/bJe9ASculcZgcKQ52R8og2w/;
  const rescue = "https://buy.stripe.com/bJebJ0eCt0cu3ag2UJ8og2I";
  assert.match(page, /id="scan-repository"/);
  assert.match(page, /START FREE/);
  assert.match(page, /FIXED IN 24 HOURS/);
  assert.match(page, /Deploy Rescue/);
  assert.match(page, /€49/);
  assert.equal(page.split(rescue).length - 1, 2);
  assert.match(page, /target="_blank"/);
  assert.match(page, /rel="noopener noreferrer"/);
  assert.doesNotMatch(page, /HUMAN SECOND OPINION|One repo audit|Manuell repogranskning/);
  assert.doesNotMatch(page, /€149/);
  assert.doesNotMatch(page, deadAudit);
  assert.doesNotMatch(page, /cNi7sKbqh6ASh169j78og2L|00w5kC9i91gybGMgLz8og2K/);
  assert.doesNotMatch(page, /billing-events|create-checkout|planPrice/);

  for (const file of ["src/lib/plans.ts", "src/lib/billing-events.ts", "src/app/api/stripe/create-checkout/route.ts", "src/app/page.tsx"]) {
    assert.doesNotMatch(read(file), deadAudit);
  }
});
