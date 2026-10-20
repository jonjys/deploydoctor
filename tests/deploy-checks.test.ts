import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSnapshot, type RepositorySnapshot } from "../src/lib/analyzer";
import { analysisText } from "../src/lib/analysis-text";
import { guideBySlug } from "../src/lib/guides";
import { messages } from "../src/lib/i18n";
import { describeStack, detectStack } from "../src/lib/stack";

/** A snapshot where every file in `files` is in the tree and was read; `unread` files are only in the tree. */
function snapshot(files: Record<string, string>, unread: string[] = []): RepositorySnapshot {
  const paths = [...Object.keys(files), ...unread];
  const source = (file: string) => /\.[cm]?[jt]sx?$/.test(file);
  return {
    owner: "example", name: "repo", defaultBranch: "main",
    entries: paths.map((path) => ({ path, type: "blob" as const })),
    contents: new Map(Object.entries(files)),
    sourceFilesFound: paths.filter(source).length,
    sourceFilesRead: Object.keys(files).filter(source).length,
    partial: false,
  };
}

const buildConfig = (files: Record<string, string>, options: { unread?: string[]; lang?: "en" | "sv" } = {}) =>
  analyzeSnapshot(snapshot(files, options.unread), { checks: ["vercel"], lang: options.lang }).checks.find((check) => check.id === "build-config")!;
const nextPkg = (version = "16.3.6", build = "next build") => JSON.stringify({ dependencies: { next: version, react: "19.2.8" }, scripts: { build } });
const page = { "app/page.tsx": "export default function Page() { return null }" };

test("build configuration: a webpack config on Next.js 16 without a bundler flag is red", () => {
  const config = "import type { NextConfig } from \"next\";\n\nconst nextConfig: NextConfig = {\n  webpack: (config) => {\n    config.resolve.fallback = { fs: false };\n    return config;\n  },\n};\n\nexport default nextConfig;\n";
  const build = buildConfig({ "package.json": nextPkg(), "next.config.ts": config, ...page });
  assert.equal(build.status, "red");
  assert.equal(build.findings?.length, 1);
  assert.equal(build.findings?.[0].file, "next.config.ts");
  assert.equal(build.findings?.[0].line, 4);
  assert.match(build.findings?.[0].problem ?? "", /^sets a custom webpack config, but Next\.js 16 runs next build with Turbopack by default/);
  assert.match(build.findings?.[0].fix ?? "", /next build --webpack.*next build --turbopack/);
  assert.match(build.explanation, /^1 project setting stops the Vercel build\.$/);
  assert.match(buildConfig({ "package.json": nextPkg(), "next.config.ts": config, ...page }, { lang: "sv" }).findings?.[0].problem ?? "", /Turbopack som standard/);
  // The method form and an assignment are a webpack config too.
  assert.equal(buildConfig({ "package.json": nextPkg(), "next.config.js": "module.exports = {\n  webpack(config) { return config },\n};", ...page }).status, "red");
  assert.equal(buildConfig({ "package.json": nextPkg("^17.0.0"), "next.config.mjs": "const c = {};\nc.webpack = (config) => config;\nexport default c;", ...page }).findings?.[0].line, 2);
});

test("build configuration: a webpack config is fine with a bundler flag, a turbopack option or Next.js 15", () => {
  const config = "module.exports = { webpack: (config) => config };";
  const fine: Array<[string, Record<string, string>]> = [
    ["Next.js 15", { "package.json": nextPkg("15.5.0"), "next.config.js": config }],
    ["--webpack", { "package.json": nextPkg("16.3.6", "next build --webpack"), "next.config.js": config }],
    ["--turbopack", { "package.json": nextPkg("16.3.6", "next build --turbopack"), "next.config.js": config }],
    ["turbopack option", { "package.json": nextPkg(), "next.config.js": "module.exports = { turbopack: {}, webpack: (config) => config };" }],
    ["vercel.json buildCommand", { "package.json": nextPkg(), "next.config.js": config, "vercel.json": '{ "buildCommand": "next build --webpack" }' }],
    ["a build that is not next build", { "package.json": nextPkg("16.3.6", "turbo run build"), "next.config.js": config }],
    ["commented out", { "package.json": nextPkg(), "next.config.js": "module.exports = {\n  // webpack: (config) => config,\n};" }],
    ["only an import", { "package.json": nextPkg(), "next.config.js": "const webpack = require(\"webpack\");\nmodule.exports = { env: { A: new webpack.DefinePlugin({}) ? \"1\" : \"0\" } };" }],
    ["latest", { "package.json": nextPkg("latest"), "next.config.js": config }],
    // Plugin options named webpack are objects, not a webpack config.
    ["Sentry options", { "package.json": nextPkg(), "next.config.js": "const { withSentryConfig } = require(\"@sentry/nextjs\");\nmodule.exports = withSentryConfig({}, { webpack: { treeshake: { removeDebugLogging: true } } });" }],
  ];
  for (const [name, files] of fine) assert.equal(buildConfig({ ...files, ...page }).status, "green", name);
});

test("build configuration: a webpack config that a plugin, a function or a spread wraps is a warning, since Next.js reads turbopack after plugins run", () => {
  // @next/mdx and next-intl add a turbopack option when TURBOPACK is set, which Next.js 16 does by default.
  const intl = "import createNextIntlPlugin from \"next-intl/plugin\";\n\nconst withNextIntl = createNextIntlPlugin();\n\nexport default withNextIntl({\n  webpack: (config) => config,\n});\n";
  const build = buildConfig({ "package.json": nextPkg("16.0.0"), "next.config.ts": intl, ...page });
  assert.equal(build.status, "yellow");
  assert.equal(build.findings?.length, 1);
  assert.equal(build.findings?.[0].line, 6);
  assert.match(build.findings?.[0].problem ?? "", /^sets a custom webpack config with no turbopack option, which makes Next\.js 16 stop next build, but next\.config passes its config through a plugin/);
  assert.match(build.findings?.[0].problem ?? "", /@next\/mdx and next-intl/);
  assert.match(build.findings?.[0].fix ?? "", /^Run next build on your machine\./);
  assert.match(buildConfig({ "package.json": nextPkg(), "next.config.ts": intl, ...page }, { lang: "sv" }).findings?.[0].problem ?? "", /skickar konfigurationen genom ett plugin/);
  const wrapped: Array<[string, string]> = [
    ["plugin called inline", "const nextConfig = { webpack: (config) => config };\nexport default require(\"next-intl/plugin\")()(nextConfig);"],
    ["a config wrapped where it is declared", "const withTM = require(\"next-transpile-modules\")([]);\nconst nextConfig = withTM({ webpack: (config) => config });\nmodule.exports = nextConfig;"],
    ["reassigned", "let nextConfig = { webpack: (config) => config };\nnextConfig = withPlugins(nextConfig);\nexport default nextConfig;"],
    ["a function", "module.exports = (phase) => ({ webpack: (config) => config });"],
    ["a spread", "import base from \"./base.mjs\";\nexport default { ...base, webpack: (config) => config };"],
  ];
  for (const [name, config] of wrapped) assert.equal(buildConfig({ "package.json": nextPkg(), "next.config.mjs": config, ...page }).status, "yellow", name);
  // A spread inside the webpack function and a type annotation keep the plain object red.
  const plain = "import type { NextConfig } from \"next\";\nconst nextConfig: NextConfig = {\n  webpack: (config) => {\n    config.resolve.alias = { ...config.resolve.alias, a: \"b\" };\n    return config;\n  },\n};\nexport default nextConfig satisfies NextConfig;\n";
  assert.equal(buildConfig({ "package.json": nextPkg(), "next.config.ts": plain, ...page }).status, "red");
});

test("build configuration: @next/mdx and nextra add a turbopack option when the config loads, while next-pwa adds only webpack and stops the build", () => {
  const mdx = "import createMDX from \"@next/mdx\";\n\nconst withMDX = createMDX({});\nconst nextConfig = {\n  pageExtensions: [\"ts\", \"tsx\", \"mdx\"],\n  webpack(config) { return config },\n};\n\nexport default withMDX(nextConfig);\n";
  assert.equal(buildConfig({ "package.json": nextPkg(), "next.config.mjs": mdx, ...page }).status, "green");
  assert.equal(buildConfig({ "package.json": nextPkg(), "next.config.mjs": "import nextra from \"nextra\";\nexport default nextra({})({ webpack: (config) => config });", ...page }).status, "green");
  // next-pwa adds a webpack function of its own, so the build stops even though next.config has none.
  const pwa = "import withPWA from \"next-pwa\";\n\nexport default withPWA({ dest: \"public\" })({\n  reactStrictMode: true,\n});\n";
  const stopped = buildConfig({ "package.json": nextPkg(), "next.config.mjs": pwa, ...page });
  assert.equal(stopped.status, "red");
  assert.equal(stopped.findings?.[0].line, 1);
  assert.match(stopped.findings?.[0].problem ?? "", /^loads next-pwa, which adds a webpack config and no turbopack option, so Next\.js 16 stops next build/);
  assert.match(stopped.findings?.[0].fix ?? "", /^Build with Webpack by changing the build script to next build --webpack/);
  assert.match(buildConfig({ "package.json": nextPkg(), "next.config.mjs": pwa, ...page }, { lang: "sv" }).findings?.[0].problem ?? "", /^laddar next-pwa/);
  for (const plugin of ["@ducanh2912/next-pwa", "@serwist/next"]) {
    assert.equal(buildConfig({ "package.json": nextPkg(), "next.config.mjs": pwa.replace("next-pwa", plugin), ...page }).status, "red", plugin);
  }
  // Next.js 15 builds with Webpack, and a build script that picks Webpack is fine too.
  assert.equal(buildConfig({ "package.json": nextPkg("15.5.0"), "next.config.mjs": pwa, ...page }).status, "green");
  assert.equal(buildConfig({ "package.json": nextPkg("16.3.6", "next build --webpack"), "next.config.mjs": pwa, ...page }).status, "green");
});

test("build configuration: the turbopack shorthand, quoted and assigned keys, and the build script behind npm run build", () => {
  const config = "module.exports = { webpack: (config) => config };";
  const fine: Array<[string, Record<string, string>]> = [
    ["shorthand", { "package.json": nextPkg(), "next.config.mjs": "const turbopack = {};\nexport default { turbopack, webpack(config) { return config } };" }],
    ["quoted key", { "package.json": nextPkg(), "next.config.js": "module.exports = { \"turbopack\": {}, webpack: (config) => config };" }],
    ["assigned", { "package.json": nextPkg(), "next.config.js": "const c = { webpack: (config) => config };\nc.turbopack = {};\nmodule.exports = c;" }],
    // Next.js also counts any experimental key that starts with turbo.
    ["experimental turbo key", { "package.json": nextPkg(), "next.config.js": "module.exports = { experimental: { turbopackFileSystemCacheForBuild: true }, webpack: (config) => config };" }],
    ["vercel.json runs a build script with --webpack", { "package.json": nextPkg("16.3.6", "next build --webpack"), "next.config.js": config, "vercel.json": "{ \"buildCommand\": \"npm run build\" }" }],
    ["TURBOPACK=1", { "package.json": nextPkg("16.3.6", "TURBOPACK=1 next build"), "next.config.js": config }],
    ["NEXT_RSPACK", { "package.json": nextPkg("16.3.6", "cross-env NEXT_RSPACK=true next build"), "next.config.js": config }],
  ];
  for (const [name, files] of fine) assert.equal(buildConfig({ ...files, ...page }).status, "green", name);
  const red: Array<[string, Record<string, string>]> = [
    ["vercel.json runs the build script", { "package.json": nextPkg(), "next.config.js": config, "vercel.json": "{ \"buildCommand\": \"pnpm run build\" }" }],
    ["yarn build", { "package.json": nextPkg(), "next.config.js": config, "vercel.json": "{ \"buildCommand\": \"yarn build\" }" }],
    // TURBOPACK=auto is the value Next.js sets itself when nothing picks a bundler.
    ["TURBOPACK=auto", { "package.json": nextPkg("16.3.6", "TURBOPACK=auto next build"), "next.config.js": config }],
  ];
  for (const [name, files] of red) assert.equal(buildConfig({ ...files, ...page }).status, "red", name);
});

const exportConfig = "/** @type {import('next').NextConfig} */\nconst nextConfig = {\n  output: 'export',\n  async rewrites() { return [] },\n};\n\nexport default nextConfig;\n";

test("build configuration: with output export, a dynamic route without generateStaticParams is red", () => {
  const blogPage = "import { notFound } from \"next/navigation\";\n\nexport default async function Post({ params }) {\n  return null;\n}\n";
  const files = { "package.json": nextPkg(), "next.config.mjs": exportConfig, ...page, "app/(site)/blog/[slug]/page.tsx": blogPage };
  const build = buildConfig(files);
  assert.equal(build.status, "red");
  assert.equal(build.findings?.length, 1);
  assert.equal(build.findings?.[0].file, "app/(site)/blog/[slug]/page.tsx");
  assert.equal(build.findings?.[0].line, 3);
  assert.match(build.findings?.[0].problem ?? "", /^\/blog\/\[slug\] is a dynamic route without generateStaticParams, and next\.config sets output to export/);
  assert.match(build.findings?.[0].fix ?? "", /remove output: export from next\.config/);

  const withParams = "export function generateStaticParams() {\n  return [{ slug: \"first\" }];\n}\n" + blogPage;
  assert.equal(buildConfig({ ...files, "app/(site)/blog/[slug]/page.tsx": withParams }).status, "green");
  // generateStaticParams in a parent layout covers the page, and an unread layout might hold it.
  assert.equal(buildConfig({ ...files, "app/(site)/blog/[slug]/layout.tsx": "export async function generateStaticParams() { return [] }\nexport default function L({ children }) { return children }" }).status, "green");
  assert.equal(buildConfig(files, { unread: ["app/(site)/layout.tsx"] }).status, "green");
  // Without output export, a dynamic route renders on request and is fine.
  assert.equal(buildConfig({ ...files, "next.config.mjs": "export default {\n  // output: 'export',\n};" }).status, "green");
  assert.equal(buildConfig({ ...files, "next.config.mjs": "export default { output: 'standalone' };" }).status, "green");
});

test("build configuration: with output export, the features the static exports guide lists as unsupported are yellow", () => {
  const files = {
    "package.json": nextPkg(), "next.config.js": exportConfig, ...page,
    "app/api/hello/route.ts": "export const dynamic = 'force-static' as const;\n\nexport async function GET() {\n  return Response.json({ ok: true });\n}\n\nexport async function POST(request: Request) {\n  return Response.json(await request.json());\n}\n",
    "app/feed.json/route.ts": "export const dynamic = 'force-static';\n\nexport async function GET() { return Response.json([]) }\n",
    "app/sitemap.xml/route.ts": "export const revalidate = 3600;\nexport function GET() { return new Response('') }\n",
    "app/news/page.tsx": "export const revalidate = 60;\n\nexport default function News() { return null }\n",
    "app/live/page.tsx": "export const revalidate = 0;\nexport default function Live() { return null }\n",
    "middleware.ts": "export function middleware() {}\n",
    "app/actions.ts": "\"use server\";\n\nexport async function save() {}\n",
    "app/form.tsx": "export default function Form() {\n  async function submit() {\n    'use server';\n  }\n  return <form action={submit} />;\n}\n",
    "app/notes.tsx": "export const note = \"use server only for actions\";\n",
    "pages/api/legacy.ts": "export default function handler(req, res) { res.json({}) }\n",
    "pages/isr.tsx": "export async function getStaticProps() {\n  return { props: {}, revalidate: 30 };\n}\nexport default function Isr() { return null }\n",
  };
  const build = buildConfig(files);
  assert.equal(build.status, "yellow");
  const found = build.findings?.map((finding) => `${finding.file}:${finding.line}`);
  assert.deepEqual(found, [
    "app/actions.ts:1", "app/api/hello/route.ts:7", "app/form.tsx:3", "app/news/page.tsx:1",
    "middleware.ts:1", "pages/api/legacy.ts:1", "pages/isr.tsx:2",
  ]);
  const problems = build.findings?.map((finding) => finding.problem) ?? [];
  assert.match(problems[1], /^exports POST, but with output set to export in next\.config Next\.js only supports GET route handlers/);
  assert.match(problems[3], /^sets revalidate to 60, but Incremental Static Regeneration is not supported in a static export/);
  assert.match(problems[4], /does not support Proxy or middleware/);
  assert.match(problems[0], /^defines a Server Action with use server/);
  assert.match(problems[5], /API Routes cannot be used with a static export/);
  assert.match(problems[6], /^sets revalidate to 30/);
  assert.match(build.explanation, /^7 project settings may make/);
  // Rewrites in next.config and next/image with the default loader are not reported: Next.js skips both warnings on Vercel.
  assert.ok(problems.every((problem) => !/rewrites|image/i.test(problem)));
  // The same files without output export are fine.
  assert.equal(buildConfig({ ...files, "next.config.js": "module.exports = {};" }).status, "green");
});

test("build configuration: with output export, getServerSideProps stops next build, so it is red", () => {
  const ssr = "export async function getServerSideProps() { return { props: {} } }\nexport default function Ssr() { return null }\n";
  const files = { "package.json": nextPkg(), "next.config.js": exportConfig, ...page, "pages/ssr.tsx": ssr };
  const build = buildConfig(files);
  assert.equal(build.status, "red");
  assert.equal(build.findings?.[0].file, "pages/ssr.tsx");
  assert.equal(build.findings?.[0].line, 1);
  assert.match(build.findings?.[0].problem ?? "", /^uses getServerSideProps, which next build rejects in a static export/);
  assert.match(buildConfig(files, { lang: "sv" }).findings?.[0].problem ?? "", /^använder getServerSideProps, som next build avvisar/);
  assert.equal(buildConfig({ ...files, "next.config.js": "module.exports = {};" }).status, "green");
});

test("build configuration: with output export, a GET route handler not marked static and a dynamic route handler without generateStaticParams are red", () => {
  const files = { "package.json": nextPkg(), "next.config.mjs": exportConfig, ...page };
  const handler = "export async function GET() {\n  return Response.json({ ok: true });\n}\n";
  const build = buildConfig({ ...files, "app/api/hello/route.ts": handler });
  assert.equal(build.status, "red");
  assert.equal(build.findings?.length, 1);
  assert.equal(build.findings?.[0].line, 1);
  assert.match(build.findings?.[0].problem ?? "", /^has a GET route handler that is not marked static, so with output set to export in next\.config, next build stops/);
  assert.match(build.findings?.[0].fix ?? "", /export const dynamic = force-static/);
  assert.match(build.explanation, /^1 project setting stops the Vercel build\.$/);
  const marked = [
    "export const dynamic = \"force-static\";\n" + handler,
    "export const dynamic = 'error';\n" + handler,
    "export const revalidate = false;\n" + handler,
    // Markers that come from another file cannot be read, so nothing is reported.
    "export * from \"./handler\";",
    "export { dynamic, GET } from \"./shared\";",
  ];
  for (const source of marked) assert.equal(buildConfig({ ...files, "app/api/hello/route.ts": source }).status, "green", source);
  assert.equal(buildConfig({ ...files, "app/api/hello/route.ts": "export const revalidate = 0;\n" + handler }).status, "red");

  // A dynamic route handler takes generateStaticParams only from its own file, not from a layout.
  const dynamic = "export const dynamic = \"force-static\";\n\nexport async function GET(request: Request, { params }) {\n  return Response.json(await params);\n}\n";
  const route = buildConfig({ ...files, "app/api/[id]/route.ts": dynamic, "app/api/[id]/layout.tsx": "export function generateStaticParams() { return [] }\nexport default function L({ children }) { return children }" });
  assert.equal(route.status, "red");
  assert.equal(route.findings?.length, 1);
  assert.equal(route.findings?.[0].file, "app/api/[id]/route.ts");
  assert.match(route.findings?.[0].problem ?? "", /^\/api\/\[id\] is a dynamic route without generateStaticParams/);
  assert.match(route.findings?.[0].fix ?? "", /^Export generateStaticParams from this route file/);
  // Without force-static it is one finding: generateStaticParams fixes both errors.
  assert.equal(buildConfig({ ...files, "app/api/[id]/route.ts": handler }).findings?.length, 1);
  assert.equal(buildConfig({ ...files, "app/api/[id]/route.ts": "export function generateStaticParams() {\n  return [{ id: \"1\" }];\n}\n" + dynamic }).status, "green");
});

test("build configuration: with output export, private folders, export star, and middleware or proxy Next.js does not read are not reported", () => {
  const files = { "package.json": nextPkg(), "next.config.mjs": exportConfig, ...page };
  const draft = "export default function Draft({ params }) { return null }\n";
  const fine: Array<[string, Record<string, string>]> = [
    ["private folder", { "app/_drafts/[id]/page.tsx": draft, "app/_lib/api/route.ts": "export function GET() { return new Response('') }" }],
    ["export star in the page", { "app/blog/[slug]/page.tsx": "export * from \"./params\";\nexport { default } from \"./post\";\n" }],
    ["export star in a layout", { "app/blog/layout.tsx": "export * from \"./params\";\nexport default function L({ children }) { return children }", "app/blog/[slug]/page.tsx": draft }],
    ["src middleware with a root app folder", { "src/middleware.ts": "export function middleware() {}" }],
    ["a dev proxy script on Next.js 15", { "package.json": nextPkg("15.5.0"), "proxy.ts": "import http from \"node:http\";\nhttp.createServer().listen(3001);" }],
    // Next.js only loads middleware and proxy files with its page extensions, so a .mjs script of that name is not one.
    ["a middleware.mjs script", { "middleware.mjs": "export function middleware() {}" }],
    ["a proxy.cjs script", { "proxy.cjs": "module.exports = {}" }],
  ];
  for (const [name, extra] of fine) assert.equal(buildConfig({ ...files, ...extra }).status, "green", name);
  assert.deepEqual(buildConfig({ ...files, "proxy.ts": "export function proxy() {}" }).findings?.map((finding) => finding.file), ["proxy.ts"]);
  const srcApp = { "package.json": nextPkg(), "next.config.mjs": exportConfig, "src/app/page.tsx": page["app/page.tsx"], "src/middleware.ts": "export function middleware() {}" };
  assert.deepEqual(buildConfig(srcApp).findings?.map((finding) => finding.file), ["src/middleware.ts"]);
  // A Server Action in another app with its own package.json is that app's business.
  assert.equal(buildConfig({ ...files, "apps/admin/package.json": "{}", "apps/admin/app/actions.ts": "\"use server\";\nexport async function save() {}" }).status, "green");
});

test("build configuration: next/image with a literal remote src on a host next.config does not allow", () => {
  const avatar = [
    "import Image from \"next/image\";",
    "",
    "export default function Avatar() {",
    "  return (",
    "    <Image",
    "      onError={() => console.log(\"x > y\")}",
    "      src=\"https://images.example.com/u/1.png\"",
    "      alt=\"\" width={64} height={64}",
    "    />",
    "  );",
    "}",
  ].join("\n");
  const files = { "package.json": nextPkg(), ...page, "app/avatar.tsx": avatar };
  const build = buildConfig(files);
  assert.equal(build.status, "yellow");
  assert.equal(build.findings?.length, 1);
  assert.equal(build.findings?.[0].file, "app/avatar.tsx");
  assert.equal(build.findings?.[0].line, 7);
  assert.match(build.findings?.[0].problem ?? "", /^next\/image loads https:\/\/images\.example\.com\/u\/1\.png, but images\.example\.com is not in images\.remotePatterns or images\.domains/);
  assert.match(build.findings?.[0].problem ?? "", /400 Bad Request/);
  assert.match(build.findings?.[0].fix ?? "", /new URL\(https:\/\/images\.example\.com\/\*\*\)/);
  assert.equal(buildConfig({ ...files, "next.config.ts": "export default { images: { remotePatterns: [] } };" }).status, "yellow");
  assert.equal(buildConfig({ ...files, "next.config.ts": "export default { images: { remotePatterns: [{ protocol: 'https', hostname: 'cdn.other.com' }] } };" }).status, "yellow");
  // A host that looks like images.something is a string, not a change to the images config.
  const unsplash = "import Image from 'next/image';\nexport const A = () => <Image src=\"https://images.unsplash.com/photo-1\" alt=\"\" width={1} height={1} />;";
  const unsplashFiles = { "package.json": nextPkg(), ...page, "app/a.tsx": unsplash };
  assert.equal(buildConfig({ ...unsplashFiles, "next.config.ts": "export default { images: { remotePatterns: [{ hostname: 'images.example.com' }] } };" }).status, "yellow");
  assert.equal(buildConfig({ ...unsplashFiles, "next.config.ts": "export default { images: { remotePatterns: [{ hostname: 'images.unsplash.com' }] } };" }).status, "green");

  const allowed = [
    "export default { images: { remotePatterns: [{ protocol: 'https', hostname: 'images.example.com', pathname: '/u/**' }] } };",
    "export default { images: { remotePatterns: [new URL('https://**.example.com/**')] } };",
    "export default { images: { remotePatterns: [{ hostname: '*.example.com' }] } };",
    "module.exports = { images: { domains: ['images.example.com'] } };",
    "module.exports = { images: { unoptimized: true } };",
    "module.exports = { images: { loader: 'custom', loaderFile: './loader.ts' } };",
    // Patterns built at runtime cannot be read, so nothing is reported.
    "const patterns = [];\nmodule.exports = { images: { remotePatterns: patterns } };",
    "module.exports = { images: { remotePatterns: [{ hostname: process.env.CDN_HOST }] } };",
    "const images = { remotePatterns: [] };\nmodule.exports = { images };",
    "module.exports = { images: imageConfig };",
    "const nextConfig = { images: { remotePatterns: [] } };\nnextConfig.images.remotePatterns.push({ hostname: 'images.example.com' });\nmodule.exports = nextConfig;",
  ];
  for (const config of allowed) assert.equal(buildConfig({ ...files, "next.config.js": config }).status, "green", config);
  // An unread next.config could allow the host.
  assert.equal(buildConfig(files, { unread: ["next.config.js"] }).status, "green");
  // An app in a subfolder with its own next.config or package.json is built with its own image settings.
  const nested = { "apps/web/package.json": JSON.stringify({ dependencies: { next: "16.3.6" } }), "apps/web/next.config.js": "module.exports = { images: { domains: ['images.example.com'] } };", "apps/web/app/avatar.tsx": avatar };
  assert.equal(buildConfig({ "package.json": nextPkg(), ...page, ...nested }).status, "green");

  const notFlagged = [
    "import Image from 'next/image';\nexport const A = () => <Image src=\"/local.png\" alt=\"\" width={1} height={1} />;",
    "import Image from 'next/image';\nexport const A = () => <Image unoptimized src=\"https://images.example.com/a.png\" alt=\"\" width={1} height={1} />;",
    "import Image from 'next/image';\nexport const A = () => <Image loader={({ src }) => src} src=\"https://images.example.com/a.png\" alt=\"\" width={1} height={1} />;",
    "import Image from 'next/image';\nexport const A = () => <Image src=\"https://images.example.com/logo.svg\" alt=\"\" width={1} height={1} />;",
    "import Image from 'next/image';\nexport const A = ({ url }) => <Image src={url} alt=\"\" width={1} height={1} />;",
    "import Image from 'next/image';\nexport const A = (props) => <Image {...props} src=\"https://images.example.com/a.png\" alt=\"\" />;",
    "import Image from 'next/image';\n// <Image src=\"https://images.example.com/a.png\" />\nexport const A = () => null;",
    "export const A = () => <img src=\"https://images.example.com/a.png\" alt=\"\" />;",
  ];
  for (const source of notFlagged) assert.equal(buildConfig({ "package.json": nextPkg(), ...page, "app/a.tsx": source }).status, "green", source);
  // A renamed import, a template literal without expressions, and unoptimized={false} still count.
  const renamed = "import NextImage from 'next/legacy/image';\nexport const A = () => <NextImage unoptimized={false} src={`https://images.example.com/a.png`} alt=\"\" />;";
  assert.equal(buildConfig({ "package.json": nextPkg(), ...page, "app/a.tsx": renamed }).findings?.[0].line, 2);
});

test("build configuration: a SvelteKit adapter built for another platform is a warning", () => {
  const kitPkg = JSON.stringify({ devDependencies: { "@sveltejs/kit": "2.20.0", "@sveltejs/adapter-node": "5.2.0", vite: "7.0.0" }, scripts: { build: "vite build" } });
  const svelteConfig = (adapter: string) => `import adapter from '@sveltejs/adapter-${adapter}';\n\n/** @type {import('@sveltejs/kit').Config} */\nexport default {\n  kit: { adapter: adapter() },\n};\n`;
  const build = buildConfig({ "package.json": kitPkg, "svelte.config.js": svelteConfig("node") });
  assert.equal(build.status, "yellow");
  assert.equal(build.findings?.[0].file, "svelte.config.js");
  assert.equal(build.findings?.[0].line, 1);
  assert.match(build.findings?.[0].problem ?? "", /^configures @sveltejs\/adapter-node, which builds the app for a standalone Node server started with node build, not for Vercel/);
  assert.match(build.findings?.[0].fix ?? "", /@sveltejs\/adapter-vercel.*in svelte\.config\.js/);
  assert.match(buildConfig({ "package.json": kitPkg, "svelte.config.js": svelteConfig("netlify") }, { lang: "sv" }).findings?.[0].problem ?? "", /bygger appen för Netlify, inte för Vercel/);
  // SvelteKit 3 reads the adapter from vite.config.
  const viteConfig = "import { sveltekit } from '@sveltejs/kit/vite';\nimport adapter from '@sveltejs/adapter-cloudflare';\nexport default { plugins: [sveltekit({ adapter: adapter() })] };";
  assert.equal(buildConfig({ "package.json": kitPkg, "vite.config.ts": viteConfig }).findings?.[0].line, 2);

  for (const adapter of ["auto", "vercel", "static"]) {
    const fine = buildConfig({ "package.json": kitPkg, "svelte.config.js": svelteConfig(adapter) });
    assert.equal(fine.status, "green", adapter);
    assert.equal(fine.explanation, "One lockfile, a build script, a Node version Vercel supports and no SvelteKit adapter problem.");
  }
  // A config that picks the adapter per platform, and an adapter in a comment, are not flagged.
  const perPlatform = "import vercel from '@sveltejs/adapter-vercel';\nimport node from '@sveltejs/adapter-node';\nexport default { kit: { adapter: process.env.VERCEL ? vercel() : node() } };";
  assert.equal(buildConfig({ "package.json": kitPkg, "svelte.config.js": perPlatform }).status, "green");
  assert.equal(buildConfig({ "package.json": kitPkg, "svelte.config.js": "// import adapter from '@sveltejs/adapter-node';\nimport adapter from '@sveltejs/adapter-auto';\nexport default { kit: { adapter: adapter() } };" }).status, "green");
  // Without @sveltejs/kit the config is not read as SvelteKit.
  assert.equal(buildConfig({ "package.json": JSON.stringify({ devDependencies: { vite: "7.0.0" } }), "svelte.config.js": svelteConfig("node") }).status, "green");
});

test("build configuration: Astro rendering on demand needs an adapter, and on Vercel the Vercel adapter", () => {
  const astroPkg = JSON.stringify({ dependencies: { astro: "5.14.0" }, scripts: { build: "astro build" } });
  const noAdapter = "import { defineConfig } from 'astro/config';\n\nexport default defineConfig({\n  output: 'server',\n});\n";
  const build = buildConfig({ "package.json": astroPkg, "astro.config.mjs": noAdapter });
  assert.equal(build.status, "red");
  assert.equal(build.findings?.[0].file, "astro.config.mjs");
  assert.equal(build.findings?.[0].line, 4);
  assert.match(build.findings?.[0].problem ?? "", /^sets output to server, which renders pages on demand, but has no adapter, so astro build stops with NoAdapterInstalled/);
  assert.match(build.findings?.[0].fix ?? "", /^Run npx astro add vercel/);
  // hybrid needs an adapter on Astro 4. Astro 5 removed it, so there it is a config error, not a missing adapter.
  const astro4 = JSON.stringify({ dependencies: { astro: "^4.16.0" }, scripts: { build: "astro build" } });
  assert.equal(buildConfig({ "package.json": astro4, "astro.config.mjs": noAdapter.replace("server", "hybrid") }).status, "red");
  assert.equal(buildConfig({ "package.json": astroPkg, "astro.config.mjs": noAdapter.replace("server", "hybrid") }).status, "green");

  // A route that opts out of prerendering needs an adapter too, with or without an astro.config.
  const endpoint = "import type { APIRoute } from 'astro';\n\nexport const prerender = false;\nexport const GET: APIRoute = () => new Response('ok');\n";
  const prerender = buildConfig({ "package.json": astroPkg, "src/pages/api/ping.ts": endpoint });
  assert.equal(prerender.status, "red");
  assert.equal(prerender.findings?.[0].file, "src/pages/api/ping.ts");
  assert.equal(prerender.findings?.[0].line, 3);
  assert.match(prerender.findings?.[0].problem ?? "", /^sets prerender to false/);

  const withVercel = "import { defineConfig } from 'astro/config';\nimport vercel from '@astrojs/vercel';\n\nexport default defineConfig({\n  output: 'server',\n  adapter: vercel(),\n});\n";
  const fine = buildConfig({ "package.json": astroPkg, "astro.config.mjs": withVercel, "src/pages/api/ping.ts": endpoint });
  assert.equal(fine.status, "green");
  assert.equal(fine.explanation, "One lockfile, a build script, a Node version Vercel supports and no Astro adapter problem.");
  assert.equal(buildConfig({ "package.json": astroPkg, "astro.config.mjs": withVercel.replace("'@astrojs/vercel'", "'@astrojs/vercel/serverless'") }).status, "green");

  const node = withVercel.replace("import vercel from '@astrojs/vercel';", "import node from '@astrojs/node';").replace("vercel()", "node({ mode: 'standalone' })");
  const other = buildConfig({ "package.json": astroPkg, "astro.config.mjs": node });
  assert.equal(other.status, "yellow");
  assert.equal(other.findings?.[0].line, 6);
  assert.match(other.findings?.[0].problem ?? "", /^renders pages on demand with @astrojs\/node, but the Vercel docs for Astro say a server-rendered Astro app must use Astro's Vercel adapter/);
  assert.match(buildConfig({ "package.json": astroPkg, "astro.config.mjs": node }, { lang: "sv" }).findings?.[0].fix ?? "", /^Kör npx astro add vercel, ta bort @astrojs\/node/);

  // The shorthand adapter key counts as an adapter, and a subpath import still names the other platform.
  const shorthand = "import { defineConfig } from 'astro/config';\nimport adapter from '@astrojs/vercel';\n\nexport default defineConfig({\n  output: 'server',\n  adapter,\n});\n";
  assert.equal(buildConfig({ "package.json": astroPkg, "astro.config.mjs": shorthand }).status, "green");
  const netlify = withVercel.replace("import vercel from '@astrojs/vercel';", "import netlify from '@astrojs/netlify/functions';").replace("vercel()", "netlify()");
  assert.match(buildConfig({ "package.json": astroPkg, "astro.config.mjs": netlify }).findings?.[0].problem ?? "", /^renders pages on demand with @astrojs\/netlify,/);
  // A spread hides a missing adapter, but not the adapter that is in view.
  const spreadNode = "import base from './base.mjs';\nimport node from '@astrojs/node';\nexport default { ...base, output: 'server', adapter: node({ mode: 'standalone' }) };";
  assert.equal(buildConfig({ "package.json": astroPkg, "astro.config.mjs": spreadNode }).status, "yellow");
  // An Astro page opts out of prerendering in its frontmatter. Astro 4 builds a static site whole and ignores it without an adapter.
  const astroPage = "---\nexport const prerender = false;\nconst now = new Date();\n---\n<p>{now.toISOString()}</p>\n";
  const onDemand = buildConfig({ "package.json": astroPkg, "src/pages/now.astro": astroPage });
  assert.equal(onDemand.status, "red");
  assert.equal(onDemand.findings?.[0].file, "src/pages/now.astro");
  assert.equal(onDemand.findings?.[0].line, 2);
  assert.equal(buildConfig({ "package.json": astro4, "src/pages/now.astro": astroPage }).status, "green");
  assert.equal(buildConfig({ "package.json": astro4, "src/pages/api/ping.ts": endpoint }).status, "green");

  // Static sites need no adapter, and configs that are unread or spread from elsewhere are not judged.
  const notFlagged: Array<[string, Record<string, string>, string[]?]> = [
    ["static", { "astro.config.mjs": "import { defineConfig } from 'astro/config';\nexport default defineConfig({ site: 'https://example.com' });" }],
    ["no config", { "src/pages/index.ts": "export const prerender = true;" }],
    ["node adapter, static output", { "astro.config.mjs": "import node from '@astrojs/node';\nexport default { adapter: node({ mode: 'standalone' }) };" }],
    ["spread", { "astro.config.mjs": "import base from './base.mjs';\nexport default { ...base, output: 'server' };" }],
    ["unread", {}, ["astro.config.mjs"]],
    ["commented", { "astro.config.mjs": "export default {\n  // output: 'server',\n};" }],
  ];
  for (const [name, files, unread] of notFlagged) assert.equal(buildConfig({ "package.json": astroPkg, ...files }, { unread }).status, "green", name);
});

test("stack detection names SvelteKit, Astro, Remix, React Router and Vite, and old reports without it still describe", () => {
  const stack = (packages: Record<string, string>) => detectStack({ packageJson: JSON.stringify({ devDependencies: packages }) });
  assert.equal(stack({ "@sveltejs/kit": "2", vite: "7" }).framework, "sveltekit");
  assert.equal(describeStack(stack({ "@sveltejs/kit": "2", vite: "7", tailwindcss: "4" })), "SvelteKit, Tailwind - No Supabase");
  assert.equal(describeStack(stack({ astro: "5" }), "sv"), "Astro - Ingen Supabase");
  assert.equal(describeStack(stack({ "@remix-run/dev": "2", vite: "6" })), "Remix - No Supabase");
  assert.equal(describeStack(stack({ "@react-router/dev": "7", vite: "7" })), "React Router - No Supabase");
  assert.equal(describeStack(stack({ vite: "7", react: "19" })), "Vite - No Supabase");
  // A Next.js app that also has Vite (for Vitest, say) is a Next.js app.
  assert.equal(stack({ next: "16.3.6", vite: "7" }).framework, undefined);
  assert.equal(describeStack(stack({ next: "16.3.6", vite: "7" })), "Next.js 16 - No Supabase");
  assert.equal("framework" in stack({ express: "5" }), false);
  // Stacks saved before the field existed have no framework.
  assert.equal(describeStack({ hasPackageJson: true, hasNext: false, hasSupabase: false, hasPrisma: false, hasDrizzle: false, hasTailwind: false }), "No known framework - No Supabase");
  const report = analyzeSnapshot(snapshot({ "package.json": JSON.stringify({ devDependencies: { astro: "5" } }) }));
  assert.equal(report.stack?.framework, "astro");
  assert.equal(report.nextApp, "none");
});

test("the new copy exists in English and Swedish, and the new guides use no dashes or quotation marks in prose", () => {
  for (const key of ["home.checkStacks", "report.otherStackNotice", "report.otherStackVercel", "report.otherStackEnv"] as const) {
    assert.ok(messages.en[key] && messages.sv[key], key);
    assert.doesNotMatch(messages.en[key] + messages.sv[key], /[\u2013\u2014"\u201c\u201d\u201e]/, key);
  }
  assert.match(messages.en["report.otherStackNotice"], /\{stack\}/);
  for (const lang of ["en", "sv"] as const) {
    const build = analysisText(lang).build;
    const texts = [build.webpack(16), build.webpackFix, build.webpackPlugin(16), build.webpackPluginFix, build.exportDynamic("/a/[b]"), build.exportDynamicFix,
      build.exportDynamicRouteFix, build.exportRouteMethods("POST"),
      build.exportRouteStatic, build.exportProxy, build.exportAction, build.exportIsr(60), build.exportApiRoute, build.exportGssp,
      build.remoteImage("https://a.com/x.png", "a.com"), build.svelteAdapter("@sveltejs/adapter-node", build.svelteTargets.node),
      build.svelteAdapterFix("svelte.config.js"), build.astroOutputNoAdapter("server"), build.astroPrerenderNoAdapter, build.astroNoAdapterFix,
      build.astroOtherAdapter("@astrojs/node"), build.red(2), build.okAdapter("Astro")];
    for (const text of texts) assert.doesNotMatch(text, /[\u2013\u2014]/, text);
    assert.equal(Object.keys(build.svelteTargets).sort().join(), "bun,cloudflare,cloudflare-workers,netlify,node");
  }
  for (const slug of ["nextjs-16-webpack-config-turbopack-build-fails", "astro-cannot-use-server-rendered-pages-without-an-adapter"]) {
    const guide = guideBySlug(slug);
    assert.ok(guide, slug);
    assert.equal(guide.check, "Build configuration");
    assert.equal(guide.sections.at(-1)?.heading, "How DeployDoctor catches it");
    for (const text of [guide.title, guide.description, ...guide.sections.flatMap((section) => [section.heading, ...section.body])]) {
      assert.doesNotMatch(text, /[\u2013\u2014"\u201c\u201d\u201e]/, text);
    }
  }
});
