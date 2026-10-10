/** Short, accurate guides for the failure classes DeployDoctor checks. English only: that is where the searches are. */
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
];

export function guideBySlug(slug: string): Guide | undefined {
  return guides.find((guide) => guide.slug === slug);
}
