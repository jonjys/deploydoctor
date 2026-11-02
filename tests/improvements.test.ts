import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSnapshot, type RepositorySnapshot } from "../src/lib/analyzer";
import { findImprovements, improvementCopy, shareText } from "../src/lib/improvements";
import { detectStack } from "../src/lib/stack";
import { reportJson } from "../src/lib/report-json";

const pkg = (extra: Record<string, unknown> = {}) => JSON.stringify({ dependencies: { next: "16.4.2", react: "19.2.8" }, scripts: { build: "next build" }, ...extra });
const bare = { "package.json": pkg(), "app/layout.tsx": "export default function Layout({ children }) { return <html><body>{children}</body></html>; }", "app/page.tsx": "export default function Page() { return null; }" };

function snapshot(files: Record<string, string>, listedOnly: string[] = [], partialReasons: string[] = []): RepositorySnapshot {
  const paths = [...Object.keys(files), ...listedOnly];
  return { owner: "fixture", name: "app", defaultBranch: "main", contents: new Map(Object.entries(files)), entries: paths.map(path => ({ path, type: "blob" as const })),
    sourceFilesFound: paths.length, sourceFilesRead: Object.keys(files).length, partial: partialReasons.length > 0, partialReasons };
}
const ids = (files: Record<string, string>, listedOnly: string[] = [], partial: string[] = []) => {
  const snap = snapshot(files, listedOnly, partial);
  return analyzeSnapshot(snap).improvements!.map(item => item.id);
};

test("a bare Next.js app gets every improvement, with the file to add", () => {
  const results = analyzeSnapshot(snapshot(bare, ["README.md"]));
  assert.deepEqual(results.improvements, [
    { id: "error-boundary", file: "app/error.tsx" },
    { id: "share-image", file: "app/opengraph-image.tsx" },
    { id: "ci-check", file: ".github/workflows/deploydoctor.yml" },
    { id: "not-found-page", file: "app/not-found.tsx" },
    { id: "security-headers", file: "next.config.ts" },
    { id: "sitemap", file: "app/sitemap.ts" },
    { id: "node-version", file: "package.json" },
    { id: "lockfile", file: "package-lock.json" },
    { id: "readme-badge", file: "README.md" },
  ]);
});

test("each improvement disappears once the repository has it", () => {
  const complete = {
    ...bare,
    "package.json": pkg({ engines: { node: "22.x" } }),
    "app/layout.tsx": "export const metadata = { openGraph: { images: ['/og.png'] } };\nexport default function Layout({ children }) { return children; }",
    "app/error.tsx": "'use client'; export default function Error() { return null; }",
    "app/not-found.tsx": "export default function NotFound() { return null; }",
    "app/sitemap.ts": "export default function sitemap() { return []; }",
    "next.config.ts": "export default { async headers() { return [{ source: '/:path*', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] }]; } };",
  };
  assert.deepEqual(ids(complete, ["package-lock.json", ".github/workflows/deploydoctor.yml"]), []);
  assert.ok(!ids({ ...bare, "app/global-error.tsx": "export default function G() { return null; }" }).includes("error-boundary"), "global-error counts");
  assert.ok(!ids(bare, ["app/opengraph-image.png"]).includes("share-image"), "an image file counts");
  assert.ok(!ids(bare, [".nvmrc"]).includes("node-version"));
  assert.ok(!ids(bare, ["pnpm-lock.yaml"]).includes("lockfile"));
  assert.ok(!ids(bare, ["public/sitemap.xml"]).includes("sitemap"));
  assert.ok(!ids({ ...bare, "vercel.json": JSON.stringify({ headers: [{ source: "/(.*)", headers: [{ key: "Strict-Transport-Security", value: "max-age=63072000" }] }] }) }).includes("security-headers"));
  assert.ok(!ids({ ...bare, "proxy.ts": "export function proxy(request) { const response = NextResponse.next(); response.headers.set('X-Frame-Options', 'DENY'); return response; }" }).includes("security-headers"));
});

test("nothing is suggested from files that were not read or a tree that was cut short", () => {
  const unreadLayout = ids({ "package.json": pkg(), "app/page.tsx": "export default function Page() { return null; }" }, ["app/layout.tsx"]);
  assert.ok(!unreadLayout.includes("share-image"), "an unread layout may hold openGraph metadata");
  assert.ok(!ids(bare, ["next.config.ts"]).includes("security-headers"), "an unread next.config may set headers");
  assert.ok(!ids({ "app/page.tsx": "export default function Page() { return null; }" }, ["package.json"]).includes("node-version"), "an unread package.json says nothing");
  assert.deepEqual(ids(bare, [], ["truncated_tree"]), [], "absence in a truncated tree is not evidence");
});

test("pages router apps and other stacks only get what applies to them", () => {
  const pages = ids({ "package.json": pkg(), "pages/index.tsx": "export default function Home() { return null; }" });
  assert.ok(pages.includes("error-boundary") && pages.includes("not-found-page"));
  assert.ok(!pages.includes("share-image") && !pages.includes("sitemap"));
  const pagesFiles = analyzeSnapshot(snapshot({ "package.json": pkg(), "pages/index.tsx": "export default function Home() { return null; }" })).improvements!;
  assert.equal(pagesFiles.find(item => item.id === "not-found-page")?.file, "pages/404.tsx");
  const vite = ids({ "package.json": JSON.stringify({ dependencies: { vite: "6.0.0" } }), "src/main.ts": "console.log(1)" });
  assert.ok(!vite.some(id => ["error-boundary", "not-found-page", "share-image", "sitemap", "security-headers"].includes(id)));
  assert.ok(vite.includes("lockfile") && vite.includes("ci-check"));
  const stack = detectStack({ packageJson: undefined, envText: "", sources: [], files: ["main.py"] });
  assert.deepEqual(findImprovements(snapshot({ "main.py": "print(1)" }), stack, "none"), [], "no package.json, no JavaScript suggestions");
});

test("copy exists in both languages and links to official docs or this site", () => {
  for (const item of analyzeSnapshot(snapshot(bare, ["README.md"])).improvements!) for (const lang of ["en", "sv"] as const) {
    const copy = improvementCopy(item, lang);
    assert.ok(copy.title && copy.why.length > 30 && copy.how.includes(item.id === "lockfile" ? "" : item.file.split("/").pop()!.replace(/\.tsx$/, "")), `${item.id} ${lang}`);
    assert.match(copy.docs!, /^(?:https:\/\/(?:nextjs\.org|vercel\.com)\/docs\/|\/ci$|#badge-heading$)/);
  }
});

test("the X post says what was found and never overstates a clean scan", () => {
  assert.equal(shareText("acme/shop", { red: 2, yellow: 1 }, 3, "en"), "DeployDoctor scanned acme/shop: 2 to fix, 1 to review, plus 3 improvements to make. Find what breaks before Vercel does:");
  assert.equal(shareText("acme/shop", { red: 0, yellow: 0 }, 1, "en"), "acme/shop passed DeployDoctor's Vercel preflight ✅, plus 1 improvement to make. Check your repo before Vercel does:");
  assert.equal(shareText("acme/shop", { red: 0, yellow: 0 }, 0, "en"), "acme/shop passed DeployDoctor's Vercel preflight ✅. Check your repo before Vercel does:");
  assert.match(shareText("acme/shop", { red: 1, yellow: 0 }, 2, "sv"), /^DeployDoctor skannade acme\/shop: 1 att fixa, 0 att granska och 2 förbättringar\. Hitta felen innan Vercel gör det:$/);
  // GitHub's longest owner (39) and repository (100) names, plus the 23 characters X counts for any link.
  for (const lang of ["en", "sv"] as const) assert.ok(shareText("a".repeat(39) + "/" + "b".repeat(100), { red: 99, yellow: 99 }, 9, lang).length + 24 <= 280, lang);
});

test("API JSON lists improvements in English with absolute links, and private reports drop the public badge", () => {
  const results = analyzeSnapshot(snapshot(bare, ["README.md"]));
  const base = { id: "r1", repo_url: "https://github.com/fixture/app", created_at: results.checkedAt, results };
  const json = reportJson(base);
  const ci = json.improvements.find(item => item.id === "ci-check")!;
  assert.equal(ci.docs, "https://deploydoctor.nyttolabs.com/ci");
  assert.equal(json.improvements.find(item => item.id === "readme-badge")!.docs, "https://deploydoctor.nyttolabs.com/r/r1#badge-heading");
  assert.ok(!reportJson({ ...base, is_private: true }).improvements.some(item => item.id === "readme-badge"));
  // Improvements are not findings: they never reach Launch Readiness blockers or the check summary.
  assert.equal(json.launchReadiness.criticalBlockers.length + json.launchReadiness.reviewBeforeLaunch.filter(f => f.ruleId === null && /improvement/i.test(f.problem)).length, json.launchReadiness.criticalBlockers.length);
  assert.deepEqual(json.summary, results.summary);
  // Reports saved before improvements existed keep working.
  assert.deepEqual(reportJson({ ...base, results: { ...results, improvements: undefined } }).improvements, []);
});
