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
    "app/api/hello/route.ts": "export async function GET() {\n  return Response.json({ ok: true });\n}\n\nexport async function POST(request: Request) {\n  return Response.json(await request.json());\n}\n",
    "app/feed.json/route.ts": "export const dynamic = 'force-static';\n\nexport async function GET() { return Response.json([]) }\n",
    "app/sitemap.xml/route.ts": "export const revalidate = 3600;\nexport function GET() { return new Response('') }\n",
    "app/news/page.tsx": "export const revalidate = 60;\n\nexport default function News() { return null }\n",
    "app/live/page.tsx": "export const revalidate = 0;\nexport default function Live() { return null }\n",
    "middleware.ts": "export function middleware() {}\n",
    "app/actions.ts": "\"use server\";\n\nexport async function save() {}\n",
    "app/form.tsx": "export default function Form() {\n  async function submit() {\n    'use server';\n  }\n  return <form action={submit} />;\n}\n",
    "app/notes.tsx": "export const note = \"use server only for actions\";\n",
    "pages/api/legacy.ts": "export default function handler(req, res) { res.json({}) }\n",
    "pages/ssr.tsx": "export async function getServerSideProps() { return { props: {} } }\nexport default function Ssr() { return null }\n",
    "pages/isr.tsx": "export async function getStaticProps() {\n  return { props: {}, revalidate: 30 };\n}\nexport default function Isr() { return null }\n",
  };
  const build = buildConfig(files);
  assert.equal(build.status, "yellow");
  const found = build.findings?.map((finding) => `${finding.file}:${finding.line}`);
  assert.deepEqual(found, [
    "app/actions.ts:1", "app/api/hello/route.ts:5", "app/api/hello/route.ts:1", "app/form.tsx:3", "app/news/page.tsx:1",
    "middleware.ts:1", "pages/api/legacy.ts:1", "pages/isr.tsx:2", "pages/ssr.tsx:1",
  ]);
  const problems = build.findings?.map((finding) => finding.problem) ?? [];
  assert.match(problems[1], /^exports POST, but with output set to export in next\.config Next\.js only supports GET route handlers/);
  assert.match(problems[2], /^has a GET route handler that is not marked static/);
  assert.match(build.findings?.[2].fix ?? "", /export const dynamic = "force-static"/);
  assert.match(problems[4], /^sets revalidate to 60, but Incremental Static Regeneration is not supported in a static export/);
  assert.match(problems[5], /does not support Proxy or middleware/);
  assert.match(problems[0], /^defines a Server Action with use server/);
  assert.match(problems[6], /API Routes cannot be used with a static export/);
  assert.match(problems[7], /^sets revalidate to 30/);
  assert.match(problems[8], /^uses getServerSideProps/);
  assert.match(build.explanation, /^9 project settings may make/);
  // Rewrites in next.config and next/image with the default loader are not reported: Next.js skips both warnings on Vercel.
  assert.ok(problems.every((problem) => !/rewrites|image/i.test(problem)));
  // The same files without output export are fine.
  assert.equal(buildConfig({ ...files, "next.config.js": "module.exports = {};" }).status, "green");
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
  assert.match(build.findings?.[0].fix ?? "", /new URL\("https:\/\/images\.example\.com\/\*\*"\)/);
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
  assert.equal(buildConfig({ "package.json": astroPkg, "astro.config.mjs": noAdapter.replace("server", "hybrid") }).status, "red");

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
  for (const key of ["home.checkStacks", "report.otherStackNotice"] as const) {
    assert.ok(messages.en[key] && messages.sv[key], key);
    assert.doesNotMatch(messages.en[key] + messages.sv[key], /[\u2013\u2014"\u201c\u201d\u201e]/, key);
  }
  assert.match(messages.en["report.otherStackNotice"], /\{stack\}/);
  for (const lang of ["en", "sv"] as const) {
    const build = analysisText(lang).build;
    const texts = [build.webpack(16), build.webpackFix, build.exportDynamic("/a/[b]"), build.exportDynamicFix, build.exportRouteMethods("POST"),
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
