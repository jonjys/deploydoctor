import type { Guide } from "./guides";

/** Unique troubleshooting topics, not duplicate doorway pages. Keep each page actionable. */
export const seoGuides: Guide[] = [
  {
    "slug": "vite-spa-vercel-deep-link-404",
    "title": "Vite SPA on Vercel: fix 404 when refreshing a nested route",
    "description": "Your Vite homepage loads, but /dashboard or /settings returns 404 on refresh. Fix the SPA history fallback without hiding missing static assets.",
    "check": "Build configuration",
    "updated": "2026-10-21",
    "sections": [
      {
        "heading": "Recognize the deep-link failure",
        "body": [
          "Opening the root URL works. Navigating inside your React Router or Vue Router app works too. But pasting /dashboard into a fresh browser tab or refreshing it returns a Vercel 404. Client-side navigation never asked the server for that path; a full refresh does.",
          "Check the deployment output first. A typical Vite SPA has a dist/index.html file but no dist/dashboard/index.html. That is expected for a client-routed SPA, not a missing build artifact."
        ]
      },
      {
        "heading": "Add the SPA fallback",
        "body": [
          "For a Vite single-page app, the Vercel Vite documentation recommends rewriting unmatched navigation paths to index.html. Place vercel.json in the Vercel project's configured root directory, alongside package.json. This applies to SPA output; it is not a universal fix for server-rendered apps."
        ],
        "code": "{\n  \"$schema\": \"https://openapi.vercel.sh/vercel.json\",\n  \"rewrites\": [\n    { \"source\": \"/(.*)\", \"destination\": \"/index.html\" }\n  ]\n}"
      },
      {
        "heading": "Do not break your API or a multipage app",
        "body": [
          "A catch-all rewrite can swallow routes you intended to serve from a backend or separate HTML entry point. Confirm whether your app really is a client-only SPA. If you have /api handlers, server rendering, or multiple HTML documents, use narrower routing rules or the framework's own integration instead.",
          "When cleanUrls is enabled, Vercel's documented Vite rewrite uses / as the destination rather than /index.html. Keep that setting in mind before copying a rule from a different project."
        ]
      },
      {
        "heading": "Verify the fix",
        "body": [
          "Deploy the commit, open a nested URL in a new incognito tab, reload it, and check that the browser gets your app shell. Also request a nonexistent asset under /assets/ and verify you are not silently returning HTML where JavaScript was expected.",
          "Reference: Vercel documentation, Vite on Vercel, Using Vite to make SPAs. DeployDoctor's repository scan can help identify other build and routing configuration risks."
        ]
      }
    ]
  },
  {
    "slug": "sveltekit-adapter-vercel-deploy",
    "title": "Deploy SvelteKit to Vercel: choose the right adapter",
    "description": "SvelteKit deploys with the wrong adapter or fails to create server routes. Learn how adapter-auto differs from adapter-vercel and what to check in the output.",
    "check": "Build configuration",
    "updated": "2026-10-21",
    "sections": [
      {
        "heading": "The symptom depends on what you are deploying",
        "body": [
          "A SvelteKit app may build successfully on your laptop but serve blank or missing server routes after deployment, or the build may complain about an unsuitable adapter. Unlike a plain Vite SPA, SvelteKit can generate both static assets and server-side handlers. The adapter chooses the deployment output.",
          "First confirm that this is SvelteKit rather than Svelte + Vite. Look for @sveltejs/kit in package.json and a svelte.config.js or svelte.config.ts file."
        ]
      },
      {
        "heading": "Use the Vercel adapter for explicit deployment",
        "body": [
          "adapter-auto may detect supported hosting platforms, including Vercel, in supported releases. An explicit @sveltejs/adapter-vercel installation makes the intended platform clear and avoids relying on environment detection in nonstandard builds.",
          "Install the adapter with the package manager used by the repository, and wire it into SvelteKit's own configuration rather than a Vite-only config."
        ],
        "code": "npm install -D @sveltejs/adapter-vercel\n\n// svelte.config.js\nimport adapter from \"@sveltejs/adapter-vercel\";\n\nconst config = {\n  kit: { adapter: adapter() }\n};\nexport default config;"
      },
      {
        "heading": "Remove adapters for other platforms",
        "body": [
          "If the repository still imports adapter-node, adapter-static, adapter-netlify or adapter-cloudflare, Vercel may receive output intended for another host. Swap to the Vercel adapter and redeploy. If your product truly is static, adapter-static can be appropriate, but you must account for how server endpoints and dynamic routes will be handled.",
          "Also verify Framework Preset and Root Directory in Vercel project settings. SvelteKit code inside apps/web must not be built from an unrelated package root."
        ]
      },
      {
        "heading": "Test both page and endpoint behavior",
        "body": [
          "Open a prerendered page, a page rendered on request, and a +server.ts endpoint. A good homepage alone cannot prove that server features deployed correctly.",
          "Reference: SvelteKit documentation on adapters and the Vercel SvelteKit deployment guide. DeployDoctor checks some adapter and build configuration mismatches; it does not replace requesting the deployed endpoints."
        ]
      }
    ]
  },
  {
    "slug": "next-image-unconfigured-host-vercel",
    "title": "Next.js next/image unconfigured host: fix remotePatterns on Vercel",
    "description": "Fix the next/image hostname is not configured error. Match protocol, hostname, pathname and query-string rules in Next.js remotePatterns.",
    "check": "Build configuration",
    "updated": "2026-10-21",
    "sections": [
      {
        "heading": "Why the image is rejected",
        "body": [
          "Next.js rejects remote images whose URLs do not match the images.remotePatterns allowlist. The mismatch might be hostname, HTTPS versus HTTP, an asset subdomain, an unexpected path or an unapproved query string. A successful Vercel deployment can therefore still show broken images at runtime.",
          "Read the full remote image URL and compare it with next.config.js or next.config.ts. The URL you authorize should be controlled by you or a provider you trust."
        ]
      },
      {
        "heading": "Allow only the actual image host",
        "body": [
          "Add a pattern for the real hostname and the narrowest stable path that includes your images. Omitting search allows different query strings; setting search to an empty string forbids them. Choose consciously instead of accepting every host with a wildcard."
        ],
        "code": "// next.config.ts\nimport type { NextConfig } from \"next\";\n\nconst nextConfig: NextConfig = {\n  images: {\n    remotePatterns: [{\n      protocol: \"https\",\n      hostname: \"assets.example.com\",\n      pathname: \"/product-images/**\"\n    }]\n  }\n};\nexport default nextConfig;"
      },
      {
        "heading": "Check production image URLs",
        "body": [
          "The CMS may serve thumbnails from cdn.example.com while the page links to example.com. Signed image URLs may include changing query strings. Test the exact URL returned in production; a pattern that matches your development fixture may not match the real CDN.",
          "Avoid the old broad images.domains approach when remotePatterns can be made precise. Remote image allowlists are a security boundary as well as a troubleshooting setting."
        ]
      },
      {
        "heading": "When this is not a build failure",
        "body": [
          "An unconfigured-host error is often a runtime image response, not the cause of the entire deployment failing. Inspect the image request in DevTools separately from build logs.",
          "Reference: Next.js docs, next/image Un-configured Host. DeployDoctor scans repositories for a number of configuration hazards, but browser image requests still need an end-to-end test."
        ]
      }
    ]
  },
  {
    "slug": "pnpm-10-ignored-build-scripts-vercel",
    "title": "pnpm 10 ignored build scripts on Vercel: fix missing native binaries",
    "description": "pnpm 10 skips some dependency install scripts. Diagnose ignored builds that break esbuild, sharp, native packages or generated binaries during a Vercel deployment.",
    "check": "Dependencies",
    "updated": "2026-10-21",
    "sections": [
      {
        "heading": "Different problem from an outdated lockfile",
        "body": [
          "Your installation can complete successfully and still leave a native dependency or generated binary unavailable. pnpm 10 introduced tighter controls around dependency lifecycle scripts. A package whose build script was ignored may be present in node_modules but incomplete.",
          "Look in the Vercel install log for messages about ignored build scripts. Do not assume a later cannot find binary error means the package was never installed."
        ]
      },
      {
        "heading": "Approve only the dependencies that need scripts",
        "body": [
          "For pnpm 10, use pnpm approve-builds to review scripts and record the decision in workspace configuration. The exact configuration shape depends on the pnpm major version, so pin packageManager in package.json and follow documentation for that version.",
          "Review the package before approving install-time code. Approving every package defeats the safety protection."
        ],
        "code": "{\n  \"packageManager\": \"pnpm@10.32.0\"\n}\n\n# Run locally, review the prompts, and commit config + lockfile\npnpm approve-builds\npnpm install"
      },
      {
        "heading": "Make local and Vercel installs match",
        "body": [
          "Use Corepack and the same pinned pnpm major locally and on Vercel. Reinstall in a fresh checkout rather than trusting existing node_modules. Commit pnpm-lock.yaml and pnpm-workspace.yaml changes produced by your reviewed approval.",
          "A frozen lockfile mismatch has a different fix: regenerate the lockfile. Approvals are for lifecycle scripts, not a substitute for dependency integrity."
        ]
      },
      {
        "heading": "Confirm the package actually works",
        "body": [
          "Run the normal production build and, if needed, a tiny smoke test that imports the native package in a Linux environment. Some failures only occur when a function starts, not when it bundles.",
          "Reference: pnpm documentation for approve-builds. DeployDoctor can flag pnpm configuration risks; inspect the install log for the actual ignored package list."
        ]
      }
    ]
  },
  {
    "slug": "nextjs-static-export-unsupported-features",
    "title": "Next.js output export fails: dynamic routes, cookies and API handlers",
    "description": "Using output: export on Vercel? Learn why request-time routes, cookies, server handlers and default image optimization fail in a static export.",
    "check": "Build configuration",
    "updated": "2026-10-21",
    "sections": [
      {
        "heading": "What output export actually means",
        "body": [
          "With output: export, Next.js builds HTML and assets that can be served without a Node server. That is useful for static marketing sites, but it is fundamentally different from a server-rendered Next.js deployment on Vercel.",
          "If your app needs authentication cookies, personalized requests, request-time API handlers, rewrites or Incremental Static Regeneration, a pure static export cannot deliver those server behaviors."
        ]
      },
      {
        "heading": "Remove export mode for server features",
        "body": [
          "For a normal Next.js application hosted on Vercel, the simplest fix is often to remove output: export from next.config and let Vercel deploy the Next.js server functions. Do not copy a static-site template configuration into an app with an API or session cookie dependency."
        ],
        "code": "// next.config.ts\nimport type { NextConfig } from \"next\";\nconst nextConfig: NextConfig = {\n  // Do not set output: \"export\" when server routes are required.\n};\nexport default nextConfig;"
      },
      {
        "heading": "If you really need static output",
        "body": [
          "Dynamic App Router segments need generateStaticParams for every path that is built. Routes must avoid reading live request headers or cookies at render time. Default next/image optimization also requires configuration appropriate for static export, such as a custom loader or unoptimized images.",
          "An API route that reads the incoming Request cannot be a static request handler. Move dynamic behavior to a separate backend or choose a server-capable deployment."
        ]
      },
      {
        "heading": "How to reproduce the root cause",
        "body": [
          "Run npm run build with output export enabled and read the first unsupported-feature error, not the final stack trace. Identify which route requires request-time behavior before changing the whole project.",
          "Reference: Next.js Static Exports documentation and its Unsupported Features section. DeployDoctor inspects build configuration and source patterns to surface some static export conflicts."
        ]
      }
    ]
  },
  {
    "slug": "vercel-function-invocation-failed",
    "title": "FUNCTION_INVOCATION_FAILED on Vercel: debug the runtime crash",
    "description": "Vercel build is Ready but a serverless endpoint returns 500 FUNCTION_INVOCATION_FAILED. Find the real error in runtime logs and isolate the failing request.",
    "check": "Runtime diagnosis",
    "updated": "2026-10-21",
    "sections": [
      {
        "heading": "A green build does not mean the function can run",
        "body": [
          "Vercel can build and deploy an endpoint even if its first request throws, cannot connect to a database, or loads a missing runtime secret. A response mentioning FUNCTION_INVOCATION_FAILED means execution failed; it is not fixed by adding a catch-all rewrite to vercel.json.",
          "Identify one failing path and the exact time of the request. If only /api/checkout fails, diagnose that function rather than rebuilding the entire site."
        ]
      },
      {
        "heading": "Read the runtime logs, not only the build logs",
        "body": [
          "Open the deployment's Runtime Logs in Vercel, filter to the failing route and time, and inspect the stack trace. Build logs can be perfectly clean even when the runtime throws.",
          "Reproduce the request with safe, non-secret test data. A 500 without an exception message in the browser does not mean the server has no useful log output."
        ]
      },
      {
        "heading": "Common triggers",
        "body": [
          "Missing environment variables are common, especially values configured for Production but not Preview. Other causes include database connection errors, calling Node-only APIs from an Edge runtime, a missing native module, request-body parsing failures, and unhandled promise rejections.",
          "Confirm the runtime (Node versus Edge), the environment scope, and whether the failing code path relies on network services. Avoid logging secret values, authentication tokens or personal request bodies."
        ]
      },
      {
        "heading": "Fix and verify one route",
        "body": [
          "Add controlled error handling where it clarifies the failure, correct the underlying missing dependency or configuration, redeploy, then reissue the request and verify a successful response plus clean logs. Do not just swallow exceptions and return 200.",
          "DeployDoctor's log diagnosis can help interpret build and deployment errors, but it cannot prove that a production database or private upstream service is healthy."
        ]
      }
    ]
  },
  {
    "slug": "vercel-monorepo-root-directory",
    "title": "Vercel monorepo build fails: set Root Directory and workspace installs",
    "description": "Fix Vercel builds that run from the wrong monorepo folder, cannot find package.json, or fail to resolve workspace dependencies in apps/web.",
    "check": "Build configuration",
    "updated": "2026-10-21",
    "sections": [
      {
        "heading": "The monorepo symptom",
        "body": [
          "Your repository contains apps/web and packages/ui, but the Vercel project was imported with the repository root selected as the application. Build logs may show a missing framework, an unexpected package.json, or a build command running in the wrong folder.",
          "A monorepo repository and a Vercel project are not the same thing. Each deployable app needs the correct project settings even when they share one Git repository."
        ]
      },
      {
        "heading": "Configure the actual application root",
        "body": [
          "In Vercel Project Settings → Build and Deployment, set Root Directory to the directory of the app you intend to ship, such as apps/web. Review Framework Preset, Build Command and Output Directory at the same time.",
          "Do not add an invented rootDirectory field to vercel.json: project Root Directory belongs in Vercel project settings. A file-based setting at the wrong path may never be read."
        ]
      },
      {
        "heading": "Keep the workspace dependency graph intact",
        "body": [
          "A pnpm, npm or Yarn workspace app may import packages from outside its own folder. Ensure the lockfile and workspace definitions are committed and the install sees shared packages. If your Vercel setup offers including files outside the Root Directory, verify that setting for internal packages.",
          "An error resolving @acme/ui may be an install/workspace issue rather than a TypeScript path-alias problem. Test a clean install from the same workspace root that CI uses."
        ]
      },
      {
        "heading": "Verify per-project deployment settings",
        "body": [
          "In one repository with two Vercel projects, a change to apps/web should build the web project and a change to apps/admin should build the admin project. Confirm the deployed output matches the intended sub-app and that the correct Git Production Branch is selected.",
          "Reference: Vercel documentation for Monorepos and Project Settings. DeployDoctor can flag some build configuration problems but cannot read private dashboard-only Root Directory settings from a public repo scan."
        ]
      }
    ]
  },
  {
    "slug": "supabase-rls-insert-policy-denied",
    "title": "Supabase new row violates row-level security policy: fix INSERT checks",
    "description": "Fix Supabase inserts rejected by RLS without disabling security. Understand auth.uid(), WITH CHECK, grants and the difference from permission denied for table.",
    "check": "Supabase",
    "updated": "2026-10-21",
    "sections": [
      {
        "heading": "A row policy failure is not a missing GRANT",
        "body": [
          "A new row violates row-level security policy message usually means a row failed an INSERT or UPDATE policy condition for the acting role. That differs from permission denied for table, which can occur before row-level policies are evaluated.",
          "Confirm the request is made as the expected role and signed-in user. Debug the exact table, operation, authentication state and values being written."
        ]
      },
      {
        "heading": "Use WITH CHECK to validate the new row",
        "body": [
          "For INSERT, WITH CHECK determines whether the proposed row is permitted. If each signed-in user should own their records, constrain the inserted user_id to auth.uid(). Never repair the issue by allowing all writes to anon or disabling RLS."
        ],
        "code": "alter table public.todos enable row level security;\n\ncreate policy \"Insert own todos\"\non public.todos for insert to authenticated\nwith check ((select auth.uid()) = user_id);"
      },
      {
        "heading": "Match the client data to the policy",
        "body": [
          "If the client sends another user's ID, an empty user_id or no JWT, the check rejects the row as designed. Have your application identify the signed-in user and pass valid ownership data; server-side trusted writes can use a separate service-role client that never reaches the browser.",
          "For UPDATE, USING governs which existing rows can be targeted and WITH CHECK governs the resulting row. An UPDATE also often needs a SELECT policy to see rows."
        ]
      },
      {
        "heading": "Verify securely",
        "body": [
          "Test with two different user accounts: each should insert their own row and fail to insert or modify the other's data. Confirm minimum required table grants separately from RLS.",
          "Reference: Supabase Row Level Security documentation. DeployDoctor checks RLS and grants in migration SQL; it does not evaluate the authenticated identity of a live request."
        ]
      }
    ]
  },
  {
    "slug": "invalid-vercel-json-build-failed",
    "title": "Invalid vercel.json on Vercel: diagnose schema and routing errors",
    "description": "A malformed or unsupported vercel.json can block deployment. Validate configuration keys, rewrites, cron schedules and framework settings before pushing.",
    "check": "Build configuration",
    "updated": "2026-10-21",
    "sections": [
      {
        "heading": "Find the first configuration error",
        "body": [
          "Vercel reads vercel.json at the configured project root. A JSON parse error, unsupported field value or invalid routing rule can reject a deployment before app code is executed. Read the first relevant validation error in the build or deployment logs.",
          "JSON is stricter than JavaScript: comments and trailing commas are not valid. A copied JavaScript object literal is not automatically valid JSON."
        ]
      },
      {
        "heading": "Use the published schema",
        "body": [
          "Vercel publishes a JSON schema for static project configuration. Add its $schema property to vercel.json for editor validation, and use the documented framework slug, outputDirectory and rewrite forms rather than inventing keys.",
          "Root Directory is configured in Vercel Project Settings rather than in vercel.json."
        ],
        "code": "{\n  \"$schema\": \"https://openapi.vercel.sh/vercel.json\",\n  \"framework\": \"nextjs\"\n}"
      },
      {
        "heading": "Check routing intent",
        "body": [
          "An overly broad rewrite can shadow static assets or intended application routes. Rewrites preserve the displayed URL; redirects send the browser to a different URL. Choose the appropriate mechanism for your intended behavior.",
          "For Vercel Cron Jobs, review plan restrictions and schedule syntax before enabling multiple triggers. A syntactically valid configuration can still be unsupported on the current plan."
        ]
      },
      {
        "heading": "Validate then deploy",
        "body": [
          "Check the JSON syntax locally, compare properties against the official schema and run a preview build. If the project has dashboard overrides, inspect those settings too. The safest fix is a narrow correction, not deleting the whole configuration.",
          "Reference: Vercel Static Configuration with vercel.json documentation. DeployDoctor reads vercel.json to identify several configuration hazards."
        ]
      }
    ]
  },
  {
    "slug": "vercel-node-version-mismatch",
    "title": "Wrong Node.js version on Vercel: fix engines and build mismatches",
    "description": "Your app needs another Node.js major version. Check Vercel Project Settings, package.json engines and the runtime reported by deployment logs.",
    "check": "Dependencies",
    "updated": "2026-10-21",
    "sections": [
      {
        "heading": "Why local Node differs from Vercel",
        "body": [
          "A local machine might build with one Node.js major while Vercel uses another. New APIs, native binary compatibility, package engines and deprecated behavior can produce failures that appear only in cloud builds.",
          "The Vercel project setting and the package.json engines.node range both matter. Supported major versions change over time, so check Vercel's current list before choosing."
        ]
      },
      {
        "heading": "Pin an available major version",
        "body": [
          "Choose a supported Node major required by your dependencies. Vercel documents engines.node as a way to override the dashboard choice when the range maps to a supported version. Prefer a narrow supported major such as 22.x rather than a broad >=20 range that can resolve to a newer major than expected."
        ],
        "code": "{\n  \"engines\": {\n    \"node\": \"22.x\"\n  }\n}"
      },
      {
        "heading": "Inspect the runtime that actually built",
        "body": [
          "Log node -v in a safe build script or check the deployment build environment. Review the dependency's engines metadata, your package manager version and whether a native module was built against a compatible Node ABI.",
          "If your app needs Node 24, set 24.x only when your dependencies support it. Do not assume Node version changes will correct an unrelated missing environment variable or import-casing error."
        ]
      },
      {
        "heading": "Keep testing consistent",
        "body": [
          "Use the same Node major in local development, CI and Vercel. Reinstall dependencies after changing Node versions and verify a clean production build plus smoke-test critical server routes.",
          "Reference: Vercel Supported Node.js Versions. DeployDoctor can flag repository-level engine and build risk, but final runtime configuration should also be checked in the Vercel dashboard."
        ]
      }
    ]
  }
];
