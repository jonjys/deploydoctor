/** Search-intent troubleshooting guides. Some checks are static, while others require live runtime validation. */
import { seoGuides } from "./seo-guides";

export type Guide = {
  slug: string;
  title: string;
  description: string;
  updated: string;
  /** The report check this guide explains, used for the related-check line. */
  check: string;
  sections: Array<{ heading: string; body: string[]; code?: string }>;
};

export const guides: Guide[] = [
  {
    slug: "nextjs-works-locally-fails-on-vercel",
    title: "Next.js works locally but fails on Vercel: the five usual causes",
    description: "A passing local build proves less than you think. The five reasons a Next.js app works on your machine and fails on Vercel, with the fix for each.",
    updated: "2026-10-05",
    check: "all nine checks",
    sections: [
      { heading: "Why local success means little", body: [
        "npm run dev on your laptop uses your .env.local, a case insensitive file system on macOS and Windows, your globally installed tools and whatever is in node_modules right now. Vercel builds from a clean clone on Linux, installs from the lockfile, and only sees the environment variables you added in the project settings. Each of those differences is a way for a green local build to turn into a red deploy.",
      ] },
      { heading: "1. Environment variables that only exist on your machine", body: [
        "The code reads process.env.STRIPE_SECRET_KEY, .env.local has it, Vercel does not. The build log rarely says so directly. It fails somewhere downstream with undefined or a client constructor throwing at module scope.",
        "Fix: keep .env.example in sync with every variable the code reads, and add each one to the Vercel project for every environment you deploy. Preview deployments are the ones people forget.",
      ] },
      { heading: "2. Imports that resolve on macOS and fail on Linux", body: [
        "import Header from ./components/Header finds header.tsx on a case insensitive disk. Vercel builds on Linux, where that import does not resolve and the build stops with Module not found.",
        "Fix: match the casing of every import to the file name exactly. Renaming only the case of a file needs two git mv steps, because git ignores a case only rename on macOS.",
      ] },
      { heading: "3. Node only packages in Edge routes", body: [
        "An API route or middleware that declares runtime edge cannot use fs, net, dns, child_process or packages built on them, such as ioredis or pg. The bundler follows every static import, so even a branch that never runs will break the build.",
        "Fix: move the route to the Node runtime with export const runtime = nodejs, or use an HTTP based client such as @upstash/redis.",
      ] },
      { heading: "4. A lockfile that does not match package.json", body: [
        "Vercel installs with a frozen lockfile. If package.json changed and the lockfile did not, or the lockfile was written by a different package manager version, the install fails before the build starts.",
        "Fix: run the install locally with the same package manager Vercel uses, commit the updated lockfile, and never use latest as a version.",
      ] },
      { heading: "5. Prisma client not generated", body: [
        "The generated Prisma client is gitignored. If nothing runs prisma generate during install on Vercel, the import of @prisma/client fails or the query engine is missing at runtime.",
        "Fix: add a postinstall script that runs prisma generate, and make sure the schema sets the binary targets Vercel needs.",
      ], code: "{\n  \"scripts\": {\n    \"postinstall\": \"prisma generate\"\n  }\n}" },
    ],
  },
  {
    slug: "vercel-environment-variable-undefined",
    title: "process.env is undefined on Vercel: how to find the missing variable",
    description: "Your env variable works locally and is undefined on Vercel. Where Vercel reads variables from, why NEXT_PUBLIC values need a rebuild, and how to list what your code expects.",
    updated: "2026-10-05",
    check: "Environment variables",
    sections: [
      { heading: "Where Vercel reads variables from", body: [
        "Vercel never reads .env, .env.local or .env.production from your repository. Everything comes from the project settings under Environment Variables, scoped per environment: Production, Preview and Development. A variable added for Production only is undefined in every Preview deployment.",
      ] },
      { heading: "NEXT_PUBLIC variables are inlined at build time", body: [
        "Anything prefixed NEXT_PUBLIC_ is replaced in the client bundle when next build runs. Adding the variable after the build and redeploying from cache keeps the old undefined value. Use Redeploy without build cache, or push a commit.",
      ] },
      { heading: "Module scope throws kill the whole build", body: [
        "A client created at module scope, for example new Stripe(process.env.STRIPE_SECRET_KEY), runs during the build for every statically rendered page. When the key is missing the build fails with a stack trace that points at the SDK, not at the variable. Wrap such clients in a function and create them lazily inside the request handler.",
      ], code: "let client: Stripe | undefined;\nexport function stripe() {\n  const key = process.env.STRIPE_SECRET_KEY;\n  if (!key) throw new Error(\"STRIPE_SECRET_KEY is not set\");\n  return (client ??= new Stripe(key));\n}" },
      { heading: "List what your code expects", body: [
        "Search the repository for process.env. and compare the names against .env.example and against the Vercel project. DeployDoctor does that diff from the repo URL and lists every variable the code reads that .env.example does not document.",
      ] },
    ],
  },
  {
    slug: "module-not-found-vercel-case-sensitive-imports",
    title: "Module not found on Vercel but it works locally: case sensitive imports",
    description: "The import resolves on macOS and fails on Vercel with Module not found. Why Linux cares about casing, how to find the mismatch, and how to rename a file by case in git.",
    updated: "2026-10-05",
    check: "Broken imports",
    sections: [
      { heading: "The error", body: [
        "Module not found: Can't resolve ./components/Header in /vercel/path0/app. The file exists in the repository as header.tsx. On macOS and Windows the default file systems ignore case, so the import works. Vercel builds on Linux, where Header.tsx and header.tsx are different files.",
      ] },
      { heading: "Find every mismatch", body: [
        "Clone the repository on Linux, or in a Docker container, and run the build. Or scan the repository with a tool that compares each relative import against the real file tree. The same class of bug hides in dynamic imports and in paths listed in next.config.",
      ] },
      { heading: "Rename a file by case in git", body: [
        "git mv Header.tsx header.tsx is a no op on a case insensitive disk. Rename through a temporary name so git records the change.",
      ], code: "git mv components/header.tsx components/header-tmp.tsx\ngit mv components/header-tmp.tsx components/Header.tsx\ngit commit -m \"Match import casing\"" },
      { heading: "Prevent it", body: [
        "Set core.ignorecase to false in the repository, and add a lint rule or a CI job that builds on Linux before merging. Scanning the repository before every push catches it earlier than CI does.",
      ] },
    ],
  },
  {
    slug: "edge-runtime-node-module-error-vercel",
    title: "The edge runtime does not support Node.js modules: fixing fs, net and dns errors",
    description: "A route or middleware on the Edge runtime imports a Node only package and the Vercel build fails. What the Edge runtime supports, how to pick the right runtime, and which packages to swap.",
    updated: "2026-10-05",
    check: "Vercel-incompatible server code",
    sections: [
      { heading: "What the Edge runtime is", body: [
        "Edge Functions run on a subset of the Web platform, close to V8 isolates in the browser. There is no file system, no raw TCP, no DNS and no native addons. fs, net, dns, child_process and any package built on them fail at build time with an error such as The edge runtime does not support Node.js fs module.",
      ] },
      { heading: "Pick the runtime per route", body: [
        "Only middleware and routes that explicitly declare runtime edge use the Edge runtime. Everything else runs on Node. If a route needs a database driver, Redis over TCP or the file system, declare the Node runtime on that route.",
      ], code: "export const runtime = \"nodejs\";" },
      { heading: "Swap the package when you need the Edge", body: [
        "For Redis use an HTTP client such as @upstash/redis. For Postgres use a serverless driver that speaks HTTP or WebSockets. For heavyweight work such as Playwright, SQLite bindings or writing files, move it to a Node function or an external worker. Vercel Functions on Node also cannot keep files between invocations, so generated files belong in object storage.",
      ] },
      { heading: "The bundler follows every import", body: [
        "A Node only import inside an if branch still breaks the Edge build, because bundling happens before any code runs. Keep Edge code in its own files with only Edge safe imports.",
      ] },
    ],
  },
  {
    slug: "err-pnpm-outdated-lockfile-vercel",
    title: "ERR_PNPM_OUTDATED_LOCKFILE on Vercel: regenerate the lockfile the right way",
    description: "Vercel refuses to install because pnpm-lock.yaml is not up to date with package.json. Why frozen installs fail, how to regenerate the lockfile with the right pnpm version, and what not to do.",
    updated: "2026-10-05",
    check: "Dependencies and build configuration",
    sections: [
      { heading: "The error", body: [
        "ERR_PNPM_OUTDATED_LOCKFILE Cannot install with frozen-lockfile because pnpm-lock.yaml is not up to date with package.json. Vercel installs with a frozen lockfile so builds are reproducible. Any drift between the two files stops the install.",
      ] },
      { heading: "The usual causes", body: [
        "A dependency was added or bumped in package.json without running pnpm install. The lockfile was written by a different major pnpm version than the one Vercel uses. A dependency is pinned to latest or a range the lockfile cannot satisfy.",
      ] },
      { heading: "Regenerate it", body: [
        "Pin the package manager in package.json so Vercel and your machine agree, delete the stale lockfile, install, and commit the result.",
      ], code: "corepack use pnpm@10\nrm pnpm-lock.yaml\npnpm install\ngit add package.json pnpm-lock.yaml\ngit commit -m \"Regenerate lockfile with pnpm 10\"" },
      { heading: "What not to do", body: [
        "Adding --no-frozen-lockfile to the install command makes the error go away and hides the drift. Builds stop being reproducible and the next contributor gets a different tree. Fix the lockfile instead. The same applies to npm ci and yarn install --immutable.",
      ] },
    ],
  },
  {
    slug: "prisma-generate-vercel-deploy",
    title: "Prisma on Vercel: client not generated and query engine not found",
    description: "The two Prisma errors that only show up on Vercel. Why the generated client is missing, how postinstall fixes it, and what to do when the query engine binary is not found at runtime.",
    updated: "2026-10-05",
    check: "Prisma / database",
    sections: [
      { heading: "Module not found: @prisma/client has not been generated", body: [
        "The generated client lives in node_modules/.prisma and is never committed. Locally it exists because you ran prisma generate at some point. On Vercel nothing runs it unless you ask, and the install step caches node_modules between builds, so a stale client survives too.",
      ], code: "{\n  \"scripts\": {\n    \"postinstall\": \"prisma generate\",\n    \"build\": \"prisma generate && next build\"\n  }\n}" },
      { heading: "Query engine for runtime rhel-openssl-3.0.x could not be located", body: [
        "Vercel Functions run on a Linux image the client must have a binary for. Set binaryTargets in the generator block so the right engine is generated, or move to the driver adapters so there is no native engine to ship. With Next.js output tracing, make sure the engine file is included in the function bundle.",
      ], code: "generator client {\n  provider      = \"prisma-client-js\"\n  binaryTargets = [\"native\", \"rhel-openssl-3.0.x\"]\n}" },
      { heading: "Connection limits on serverless", body: [
        "Every function instance opens its own connection. Use a pooler such as Prisma Accelerate, PgBouncer or your database provider's pooled connection string for DATABASE_URL, and keep a direct URL for migrations.",
      ] },
    ],
  },
  {
    slug: "vercel-404-not-found-ready-deployment",
    title: "Vercel 404 NOT_FOUND on a Ready deployment: check the Framework Preset first",
    description: "The build is green, the deployment says Ready, and every URL returns 404 NOT_FOUND with nothing in the logs. The usual cause is a project setting, not your code. How to find it and stop it from coming back.",
    updated: "2026-10-10",
    check: "Build configuration",
    sections: [
      { heading: "What this 404 means", body: [
        "A plain white page with 404: NOT_FOUND and a Vercel error ID, on every path including the root, means the request never reached your application. Runtime Logs stay empty because no function ran. DEPLOYMENT_NOT_FOUND would mean the whole deployment is missing; NOT_FOUND means the deployment exists but has nothing to serve at that path.",
        "That points at how Vercel built and served the output, not at your routes. Removing middleware or proxy.ts rarely changes anything, which is a good sign you are in this case.",
      ] },
      { heading: "1. The Framework Preset is not Next.js", body: [
        "This is the cause in most of the recent threads on the Vercel Community forum. The preset is chosen when the project is imported. If the repository only had a README at that moment, or was a different kind of app, the preset stays on Other. Vercel then builds your code but serves the output as a plain static site, so none of the Next.js routes exist.",
        "Fix: open Project Settings, Build and Deployment, set Framework Preset to Next.js, save and redeploy. To make sure it never drifts again, pin it in vercel.json at the repository root.",
      ], code: "{\n  \"framework\": \"nextjs\"\n}" },
      { heading: "2. The app lives in a subfolder", body: [
        "In a monorepo, or a repository where the Next.js app sits in a folder such as web or apps/site, Vercel builds from the repository root unless you tell it otherwise. Set Root Directory in the project settings to the folder that contains the app's package.json.",
      ] },
      { heading: "3. A static site with Index.html", body: [
        "For a plain HTML site, Vercel serves index.html for the root path, in lower case. Linux file names are case sensitive, so Index.html gives a 404 even though it opens fine on macOS or Windows. Rename it to index.html. Git ignores a rename that only changes letter case on those systems, so rename in two steps.",
      ], code: "git mv Index.html tmp-index.html\ngit mv tmp-index.html index.html" },
      { heading: "4. Check the output, not the logs", body: [
        "Open the deployment, go to the Source tab and choose Output. If the files you expect are not there, the build settings are wrong. If they are there and the domain still returns 404, check that the domain is assigned to this project and this production deployment under Settings, Domains.",
      ] },
    ],
  },
  {
    slug: "supabase-42501-permission-denied-new-table",
    title: "Supabase 42501 permission denied for table: the missing GRANT on new tables",
    description: "A new table returns 42501 permission denied through the Supabase Data API even though RLS policies look right. Supabase is removing the automatic grants on new tables in public. What changed, how to fix it with the right GRANT, and how to catch it in your migrations.",
    updated: "2026-10-13",
    check: "Supabase",
    sections: [
      { heading: "What the error means", body: [
        "The Data API (supabase-js, REST and GraphQL) answers with code 42501 and permission denied for table your_table when the role making the request has no privilege on that table at all. This happens before row level security is even looked at, so changing policies does not help.",
        "Grants and RLS do different jobs. A GRANT decides whether a role such as anon or authenticated can reach the table. RLS policies decide which rows that role sees once it gets there. A table needs both.",
      ], code: "{\n  \"code\": \"42501\",\n  \"message\": \"permission denied for table todos\",\n  \"hint\": \"Grant the required privileges to the current role with: GRANT SELECT ON public.todos TO anon;\"\n}" },
      { heading: "Why it started now", body: [
        "Until now, tables you created in the public schema were automatically granted select, insert, update and delete to anon, authenticated and service_role. That made every new table reachable the moment it was created, even if you forgot to enable RLS.",
        "Supabase is moving the platform default to revoke those automatic grants, so exposure becomes opt in. Where the new default applies, a migration that only creates a table and its policies leaves the table unreachable, and the app gets 42501. The Supabase docs describe the change under Securing your API, Default privileges for new tables and functions.",
      ] },
      { heading: "The fix: grant only what each role needs", body: [
        "Add the grants in the same migration that creates the table and enables RLS. They belong together. Grant the minimum each role needs: read only for anonymous visitors if the data is public, full access for signed in users (still filtered by your policies), and full access for server code that uses the service role.",
      ], code: "alter table public.todos enable row level security;\n\ngrant select on table public.todos to anon;\ngrant select, insert, update, delete on table public.todos to authenticated;\ngrant select, insert, update, delete on table public.todos to service_role;\n\ncreate policy \"own todos\" on public.todos\n  for all to authenticated\n  using ((select auth.uid()) = user_id)\n  with check ((select auth.uid()) = user_id);" },
      { heading: "Do not fix it by granting everything", body: [
        "grant all on all tables in schema public to anon makes the error go away and exposes every table, including ones you never meant to put behind the Data API. If a table has no RLS, anyone with your anon key can then read and change every row. Grant table by table, and keep RLS enabled on every table the Data API can reach.",
        "Also look for policies with using (true) or with check (true) on insert, update or delete for anon. A public read policy can be intentional. A write policy that lets anyone write any row usually is not.",
      ] },
      { heading: "Catch it before you deploy", body: [
        "DeployDoctor reads supabase/migrations in order and reports, per table in public: tables with no row level security, tables with no GRANT to anon, authenticated or service_role, and policies that let anyone write without a condition. The fix for a missing grant comes with the exact SQL for that table. Scan your repository for free on the home page, or run it on every pull request with the GitHub Action.",
      ] },
    ],
  },
  {
    slug: "vercel-hobby-cron-more-than-once-a-day",
    title: "Hobby accounts are limited to daily cron jobs: fixing the Vercel deploy error",
    description: "The deployment fails because a cron job in vercel.json would run more than once per day. What the Hobby plan allows, how to read a cron expression to see how often it runs, and the two ways to fix it.",
    updated: "2026-10-15",
    check: "Build configuration",
    sections: [
      { heading: "The error", body: [
        "The deployment fails with this error: Hobby accounts are limited to daily cron jobs. This cron expression would run more than once per day. It comes from the crons list in vercel.json. On the Hobby plan, Vercel only accepts cron jobs that run once per day, and an expression that would run more often fails during deployment. Pro and Enterprise allow cron jobs as often as once per minute.",
      ], code: "{\n  \"crons\": [\n    { \"path\": \"/api/sync\", \"schedule\": \"*/30 * * * *\" }\n  ]\n}" },
      { heading: "How to tell how often an expression runs", body: [
        "Vercel reads five fields, always in UTC: minute (0 to 59), hour (0 to 23), day of month (1 to 31), month (1 to 12) and day of week (0 to 6, Sunday to Saturday). Only the minute and hour fields decide how many times a day a job runs. If either of them matches more than one value, through *, a list such as 0,30, a range such as 9-17 or a step such as */15, the job runs more than once a day.",
        "The day fields only choose which days it runs. 0 5 * * 1 runs on Mondays at 05:00 UTC and 0 5 1 * * on the first of every month, and both are fine on Hobby. 0 * * * * runs every hour and */30 * * * * every 30 minutes, and both fail on Hobby.",
      ] },
      { heading: "Fix 1: run it once a day", body: [
        "Pick one minute and one hour. On Hobby, Vercel does not promise the exact minute either: a job set to 0 1 * * * can start any time between 01:00 and 01:59 UTC, so do not depend on the minute.",
      ], code: "{\n  \"crons\": [\n    { \"path\": \"/api/sync\", \"schedule\": \"0 5 * * *\" }\n  ]\n}" },
      { heading: "Fix 2: move the project to Pro", body: [
        "If the job really has to run more often, or at a precise minute, the Pro plan runs cron jobs as often as once per minute and invokes them within the minute you set. Every plan allows up to 100 cron jobs per project.",
      ] },
      { heading: "Check the rest of the expression too", body: [
        "Vercel's cron format does not support names such as MON, SUN, JAN or DEC, so use numbers. You also cannot set both day of month and day of week: when one has a value, the other must be *. The timezone is always UTC, so convert your local time before you write the hour.",
      ] },
      { heading: "How DeployDoctor catches it", body: [
        "DeployDoctor reads vercel.json in the Build configuration check, works out from the minute and hour fields whether each cron job can run more than once a day, and points at the line of that schedule with a daily version of the same expression to use on Hobby. It cannot see which plan you are on, so it reports this as a warning that says the deployment fails on Hobby. The same check flags expressions outside Vercel's cron format, more than 100 cron jobs, a maxDuration above the 300 seconds Hobby allows, and memory set in vercel.json, which Vercel ignores with Fluid compute. Scan your repository for free on the home page, or run it on every pull request with the GitHub Action.",
      ] },
    ],
  },
  {
    slug: "nextjs-16-webpack-config-turbopack-build-fails",
    title: "Next.js 16 build fails with a webpack config: Turbopack is now the default",
    description: "After the upgrade to Next.js 16, next build stops because next.config has a webpack function. Why Next.js fails on purpose, the three ways out, and what to do when a plugin added the webpack config.",
    updated: "2026-10-17",
    check: "Build configuration",
    sections: [
      { heading: "The error", body: [
        "The build stops with ERROR: This build is using Turbopack, with a webpack config and no turbopack config. The Next.js 16 upgrade guide explains why: next build now uses Turbopack by default, and if your project has a custom webpack configuration, the build will fail to prevent misconfiguration issues.",
        "Nothing is wrong with your code. Before Next.js 16 you had to opt in to Turbopack with --turbopack, so the same next.config built with webpack before the upgrade. On Vercel the deployment fails at the build step.",
      ], code: "// next.config.ts\nconst nextConfig = {\n  webpack: (config) => {\n    config.resolve.fallback = { fs: false };\n    return config;\n  },\n};\n\nexport default nextConfig;" },
      { heading: "Why Next.js stops instead of ignoring it", body: [
        "Turbopack does not run webpack plugins. It supports webpack loaders, but anything your webpack function adds, such as a plugin, an alias or a fallback, would silently stop applying under Turbopack. Next.js refuses to guess and stops the build so you choose.",
      ] },
      { heading: "Fix 1: keep building with webpack", body: [
        "Add the --webpack flag to the build script. The dev server can keep using Turbopack. This is the safest choice when the webpack function does real work, for example a plugin you depend on.",
      ], code: "{\n  \"scripts\": {\n    \"dev\": \"next dev\",\n    \"build\": \"next build --webpack\",\n    \"start\": \"next start\"\n  }\n}" },
      { heading: "Fix 2: build with Turbopack and ignore the webpack config", body: [
        "Run next build --turbopack. The upgrade guide describes this as building with Turbopack and ignoring your webpack config. Many apps work under Turbopack with no configuration, but test the app, because whatever the webpack function changed no longer applies.",
      ] },
      { heading: "Fix 3: move the config to Turbopack", body: [
        "The third way the upgrade guide gives is to migrate the webpack config to Turbopack-compatible options under turbopack in next.config. A resolve.fallback that silenced Module not found: Can't resolve fs, for example, becomes a turbopack.resolveAlias that loads an empty module in the browser. The Next.js docs recommend fixing the imports first, so client code no longer pulls in Node.js modules.",
      ], code: "// next.config.ts\nconst nextConfig = {\n  turbopack: {\n    resolveAlias: {\n      fs: { browser: \"./empty.ts\" },\n    },\n  },\n};\n\nexport default nextConfig;" },
      { heading: "When you never wrote a webpack config", body: [
        "The upgrade guide notes that if the build fails because a webpack configuration was found and you do not define one yourself, a plugin is likely adding a webpack option, such as a wrapper around next.config. Check the plugin for a Next.js 16 or Turbopack release, or use one of the flags above until it has one.",
      ] },
      { heading: "How DeployDoctor catches it", body: [
        "DeployDoctor reads next.config, package.json and vercel.json in the Build configuration check. When the app uses Next.js 16 or later, next.config sets a webpack function and has no turbopack option, and the build command, or the build script it runs, is next build without --webpack, --turbopack or a TURBOPACK or NEXT_RSPACK setting, it reports a failing check that points at the webpack line. Next.js looks for the turbopack option after plugins have run, and plugins such as @next/mdx and next-intl add one when the config loads, so when next.config passes its config through a plugin like withMDX or withNextIntl, a function or a spread, the check is a warning instead. A webpack option that a wrapper plugin adds is not visible in next.config, so that case is not reported. Scan your repository for free on the home page, or run it on every pull request with the GitHub Action.",
      ] },
    ],
  },
  {
    slug: "astro-cannot-use-server-rendered-pages-without-an-adapter",
    title: "Astro on Vercel: Cannot use server-rendered pages without an adapter",
    description: "astro build stops with NoAdapterInstalled when a page renders on demand and no adapter is set. When an Astro site needs an adapter on Vercel, how to add @astrojs/vercel, and when a static site needs none.",
    updated: "2026-10-17",
    check: "Build configuration",
    sections: [
      { heading: "The error", body: [
        "The build stops with NoAdapterInstalled: Cannot use server-rendered pages without an adapter. Please install and configure the appropriate server adapter for your final deployment. Astro's docs put the rule plainly: to render any page on demand, you need to add an adapter.",
      ] },
      { heading: "When an Astro site renders on demand", body: [
        "By default, your entire Astro site is prerendered at build time, and a static Astro site deploys to Vercel with zero configuration. Two settings change that. output: server in astro.config renders every page on demand by default. export const prerender = false in a page or an endpoint renders that one route on demand. Either one needs an adapter.",
      ], code: "// astro.config.mjs\nimport { defineConfig } from \"astro/config\";\n\nexport default defineConfig({\n  output: \"server\",\n  // no adapter: astro build stops with NoAdapterInstalled\n});" },
      { heading: "The fix: add Astro's Vercel adapter", body: [
        "Run npx astro add vercel. It installs @astrojs/vercel and adds the adapter to astro.config. To do it by hand, install @astrojs/vercel and set adapter: vercel() yourself.",
      ], code: "// astro.config.mjs\nimport { defineConfig } from \"astro/config\";\nimport vercel from \"@astrojs/vercel\";\n\nexport default defineConfig({\n  output: \"server\",\n  adapter: vercel(),\n});" },
      { heading: "Another platform's adapter on Vercel", body: [
        "A project that started on another host can still have @astrojs/node, @astrojs/netlify or @astrojs/cloudflare in astro.config. The build then passes, but the output is shaped for that platform. Vercel's docs for Astro say that to deploy a server-rendered Astro app, you must add Astro's Vercel adapter. Replace the old adapter with @astrojs/vercel and remove it from package.json.",
      ] },
      { heading: "A static site needs no adapter", body: [
        "If nothing renders on demand, you do not need an adapter to deploy to Vercel. Astro's Vercel adapter docs say you only need it for a static site if you use additional Vercel services, such as Web Analytics or Image Optimization through the adapter. Removing output: server and every prerender = false is also a valid fix.",
      ] },
      { heading: "How DeployDoctor catches it", body: [
        "DeployDoctor reads astro.config and the JavaScript and TypeScript files under src/pages in the Build configuration check. When output is server, or hybrid on Astro 4, or a route sets prerender to false, and astro.config has no adapter, it reports a failing check that points at the line. When the adapter is @astrojs/node, @astrojs/netlify or @astrojs/cloudflare, it reports a warning with the switch to @astrojs/vercel. The same check covers SvelteKit adapters built for another platform. Scan your repository for free on the home page, or run it on every pull request with the GitHub Action.",
      ] },
    ],
  },
  ...seoGuides,
];

export function guideBySlug(slug: string): Guide | undefined {
  return guides.find((guide) => guide.slug === slug);
}
