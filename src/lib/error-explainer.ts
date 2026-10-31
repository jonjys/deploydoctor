/**
 * Free, rule-based error explainer used by /explain-error.
 * Runs entirely in the browser: no network call, no model API, nothing stored.
 * Pattern matching only, so results are the most likely cause, not a verified root cause.
 */
export type ErrorRule = {
  id: string;
  title: string;
  pattern: RegExp;
  cause: string;
  fix: string[];
  docs?: string;
  /** Warnings that are rarely the real failure: always listed after more specific matches. */
  lowPriority?: boolean;
};

export const errorRules: ErrorRule[] = [
  {
    id: "vercel-resource-limited",
    title: "Vercel plan limit reached (Resource is limited)",
    pattern: /Resource is limited\s*-?\s*try again in \d+ hours?|Resource is limited|api-deployments-free-per-day|too many (?:deployments|builds)|rate limit(?:ed)?.{0,40}deployments?/i,
    cause: "The account created more builds or deployments in a period than the Hobby plan allows. This usually comes from something triggering builds in a loop, such as CI or bot commits, or a missing Ignored Build Step.",
    fix: [
      "Find what is triggering the builds: look at recent deployments for CI, bot or automated commits pushing repeatedly.",
      "Pause Git deployments for the project, or add an Ignored Build Step so commits that should not deploy are skipped.",
      "Wait 24 hours for the limit window to reset before deploying again.",
      "If it is still blocked after the window and usage looks normal, contact Vercel support with the project and team name.",
    ],
    docs: "https://vercel.com/docs/limits",
  },
  {
    id: "next-font",
    title: "next/font could not load a font",
    pattern: /Failed to fetch (?:font|`[^`]+`)|next\/font(?::| error)|Failed to download `[^`]+` from Google Fonts|Unknown font `?[^`\s]*`?|Can't resolve [^\n]*next\/font|fonts\.googleapis\.com|Unknown (?:subset|weight)|Missing (?:required )?subsets/i,
    cause: "next/font downloads Google Fonts at build time. The build fails if the font server cannot be reached (network problem or an offline/locked-down build), if the font name, subset or weight is wrong, or if the Next.js version is too old for next/font.",
    fix: [
      "Retry the build; if it keeps failing, check that the build machine can reach fonts.googleapis.com and fonts.gstatic.com.",
      "For offline or restricted builds, self-host the font files with next/font/local instead of next/font/google.",
      "Check the font name (e.g. Inter, Roboto_Mono with underscores), and that the subsets and weights you request exist for that font.",
      "If next/font cannot be resolved, update next to a version that includes it (13.2 or later) and remove the old @next/font package.",
    ],
    docs: "https://nextjs.org/docs/app/getting-started/fonts",
  },
  {
    id: "module-not-found",
    title: "An import cannot be resolved",
    pattern: /module not found|cannot find module|can't resolve|could not resolve|ERR_MODULE_NOT_FOUND/i,
    cause: "A package is missing from package.json, or an import path does not match the real file. Filename case often differs: macOS ignores case, the Linux build server does not.",
    fix: [
      "Check whether the failing import is a local file or a package.",
      "For a local file, compare the path and capitalization with the file tracked in git (git ls-files).",
      "For a package, add it to dependencies (not only devDependencies if it is needed at runtime) and commit the lockfile.",
    ],
    docs: "https://nextjs.org/docs/messages/module-not-found",
  },
  {
    id: "env-missing",
    title: "An environment variable is missing at build or runtime",
    pattern: /(?:env(?:ironment)? var(?:iable)?s?|process\.env\.[A-Z0-9_]+).{0,60}(?:missing|undefined|not set|not defined|required)|missing (?:required )?(?:env|environment)|is not defined in (?:the )?environment|supabaseUrl is required|Missing API key|STRIPE_SECRET_KEY|DATABASE_URL/i,
    cause: "The code reads a variable that exists in your local .env file but is not set for this environment (Production, Preview or Development) in the hosting dashboard.",
    fix: [
      "Add the variable in Project Settings > Environment Variables for the environment that failed.",
      "Variables read in the browser need the NEXT_PUBLIC_ prefix and are inlined at build time, so redeploy after adding them.",
      "Never commit the value to git.",
    ],
    docs: "https://vercel.com/docs/environment-variables",
  },
  {
    id: "out-of-memory",
    title: "The build ran out of memory",
    pattern: /heap out of memory|JavaScript heap|ENOMEM|SIGKILL|exited with 137|Allocation failed|out of memory/i,
    cause: "The build process used more memory than the build machine allows, often from very large pages, big static generation, or source maps.",
    fix: [
      "Try NODE_OPTIONS=--max-old-space-size=4096 as a build environment variable if the plan allows it.",
      "Reduce work at build time: fewer statically generated pages, disable production browser source maps, split large imports.",
      "Check for an accidental import of a huge file or dataset into a page.",
    ],
    docs: "https://vercel.com/docs/deployments/troubleshoot-a-build",
  },
  {
    id: "typescript",
    title: "TypeScript type check failed",
    pattern: /Type error:|error TS\d{3,5}|Failed to compile\.[\s\S]{0,200}\.tsx?|is not assignable to type|Property '.+' does not exist on type/i,
    cause: "next build runs a full type check, which local dev mode does not. A type error that never showed in the browser stops the production build.",
    fix: [
      "Run the same build locally: npx tsc --noEmit or npm run build.",
      "Fix the first reported file and line; later errors are often caused by the first.",
      "Avoid ignoreBuildErrors as a fix; it only hides the problem.",
    ],
    docs: "https://nextjs.org/docs/app/api-reference/config/typescript",
  },
  {
    id: "eslint",
    title: "Lint errors fail the build",
    pattern: /ESLint|eslint.*error|Linting and checking validity|react-hooks\/exhaustive-deps|no-unused-vars/i,
    cause: "The production build treats lint errors as failures, while dev mode only warns.",
    fix: ["Run npm run lint locally and fix the reported rules.", "Only disable a rule for a specific line when you understand why it fires."],
    docs: "https://nextjs.org/docs/app/api-reference/config/eslint",
  },
  {
    id: "node-version",
    title: "Node.js version mismatch",
    pattern: /engine "node" is incompatible|Unsupported engine|requires? (?:a )?Node(?:\.js)? (?:version )?[>=^~v]*\d+|node: bad option|SyntaxError: Unexpected token '\?\?=?'|Node\.js version .* is (?:not supported|discontinued)|EBADENGINE/i,
    cause: "The build server uses a different Node.js version than your machine or than a dependency requires.",
    fix: [
      "Set engines.node in package.json (for example \"20.x\") or pick the version in Project Settings.",
      "Match it locally with nvm or .nvmrc and rebuild.",
    ],
    docs: "https://vercel.com/docs/functions/runtimes/node-js/node-js-versions",
  },
  {
    id: "peer-deps",
    title: "Package versions conflict",
    pattern: /\bERESOLVE\b|unable to resolve dependency tree|conflicting peer dependency/i,
    cause: "Two packages require incompatible versions of a shared dependency.",
    fix: [
      "Read the Found and peer lines in the error and pick versions that satisfy both.",
      "Commit the updated lockfile. Treat --legacy-peer-deps as a last resort, not a fix.",
    ],
    docs: "https://docs.npmjs.com/cli/v11/using-npm/config/#legacy-peer-deps",
  },
  {
    id: "lockfile",
    title: "Lockfile and package.json are out of sync",
    pattern: /npm ci can only install packages when your package\.json and package-lock\.json|lockfile (?:is )?(?:not up to date|out of date)|frozen-lockfile|ERR_PNPM_OUTDATED_LOCKFILE|Your lockfile needs to be updated/i,
    cause: "package.json changed but the lockfile was not regenerated and committed, or two package managers were mixed.",
    fix: ["Run your package manager's install locally and commit the new lockfile.", "Keep only one lockfile (package-lock.json, pnpm-lock.yaml, yarn.lock or bun.lockb)."],
  },
  {
    id: "deploy-404",
    title: "Deployed site returns 404",
    pattern: /404:? NOT_FOUND|404 \| This page could not be found|DEPLOYMENT_NOT_FOUND|Code: NOT_FOUND|\b404\b.*(?:deploy|vercel|route|page)/i,
    cause: "The route does not exist in the build output: wrong output or root directory, a file name casing issue, a missing rewrite for a single-page app, or the wrong framework preset.",
    fix: [
      "Check Root Directory and Output Directory in the project settings.",
      "For a single-page app (Vite, CRA) add a rewrite of all paths to /index.html.",
      "Confirm the page file exists with the exact casing in git.",
    ],
    docs: "https://vercel.com/docs/errors/NOT_FOUND",
  },
  {
    id: "cors",
    title: "Browser blocked a request (CORS)",
    pattern: /CORS|Access-Control-Allow-Origin|blocked by CORS policy|preflight/i,
    cause: "The API does not send Access-Control-Allow-Origin for your deployed domain, or the preflight OPTIONS request is not handled.",
    fix: [
      "Return Access-Control-Allow-Origin for the exact production and preview origins on the API.",
      "Handle the OPTIONS method in the API route.",
      "If both sides are your own app, call the API on the same origin with a relative path instead.",
    ],
    docs: "https://developer.mozilla.org/docs/Web/HTTP/Guides/CORS",
  },
  {
    id: "function-timeout",
    title: "Serverless function timed out",
    pattern: /FUNCTION_INVOCATION_TIMEOUT|Task timed out|504:? GATEWAY_TIMEOUT|exceeded the maximum duration/i,
    cause: "A request handler took longer than the allowed duration, often waiting on a slow database, external API or an unclosed connection.",
    fix: ["Log timings around external calls to find the slow step.", "Raise maxDuration if your plan allows it, or move long work to a background job."],
    docs: "https://vercel.com/docs/errors/FUNCTION_INVOCATION_TIMEOUT",
  },
  {
    id: "function-crash",
    title: "Serverless function crashed at runtime",
    pattern: /FUNCTION_INVOCATION_FAILED|500:? INTERNAL_SERVER_ERROR|Unhandled Runtime Error|Application error: a server-side exception/i,
    cause: "Code threw at runtime on the server. A missing environment variable or a database connection error is the most common reason.",
    fix: ["Open the runtime logs for the failed request and find the first stack trace.", "Check that every environment variable used by that route exists for this environment."],
    docs: "https://vercel.com/docs/errors/FUNCTION_INVOCATION_FAILED",
  },
  {
    id: "hydration",
    title: "Server HTML differs from the first browser render",
    pattern: /hydration (?:failed|error|mismatch)|text content does not match|server rendered html didn't match/i,
    cause: "The first render is not deterministic (dates, random values, browser-only state) or HTML is nested invalidly.",
    fix: ["Move browser-only values into an effect.", "Fix invalid nesting such as a div inside a p."],
    docs: "https://nextjs.org/docs/messages/react-hydration-error",
  },
  {
    id: "prerender",
    title: "A page failed during static generation",
    pattern: /Error occurred prerendering page|Export encountered errors|prerender-error|useSearchParams\(\) should be wrapped in a suspense boundary|Dynamic server usage/i,
    cause: "A page is rendered at build time but depends on request data, browser APIs, or a service that is not reachable during the build.",
    fix: [
      "Wrap useSearchParams users in a Suspense boundary.",
      "Mark request-dependent pages as dynamic, or guard browser-only code.",
      "Make sure data fetched at build time has its environment variables set.",
    ],
    docs: "https://nextjs.org/docs/messages/prerender-error",
  },
  {
    id: "case-sensitivity",
    title: "File name casing differs",
    pattern: /differs from already included file name .* only in casing|only in casing/i,
    cause: "Two imports refer to the same file with different capitalization. Linux build servers treat them as different files.",
    fix: ["Rename the file with git mv so git records the case change, then fix the imports."],
  },
  {
    id: "npm-unknown-env-config",
    title: "npm warning: Unknown env config \"cache-dir\"",
    pattern: /npm warn(?:ing)? Unknown env config "?cache-dir"?|npm_config_cache_dir/i,
    cause: "This is only a warning. The build environment sets npm_config_cache_dir, which newer npm versions do not recognize. It is usually not why the build failed.",
    fix: [
      "Look further down the log for the first line containing Error; that is usually the real failure.",
      "To silence the warning, prefix the commands: Install Command `unset npm_config_cache_dir && npm install` (or npm ci) and Build Command `unset npm_config_cache_dir && npm run build`.",
    ],
    docs: "https://docs.npmjs.com/cli/v11/using-npm/config",
    lowPriority: true,
  },
  {
    id: "build-command",
    title: "The build command exited with an error",
    pattern: /Command "(?:npm|yarn|pnpm|bun) run build" exited with \d+|Build failed|exited with code 1/i,
    cause: "This line only says the build failed. The real cause is usually a few lines above it.",
    fix: ["Scroll up in the log to the first line containing Error, and paste that block here."],
  },
];

export type Explanation = { rule: ErrorRule; line: number; excerpt: string };

export const MAX_INPUT = 20_000;

export function explainError(input: string): Explanation[] {
  const text = input.slice(0, MAX_INPUT).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  const lines = text.split(/\r?\n/);
  const found: Explanation[] = [];
  for (const rule of errorRules) {
    const index = lines.findIndex((line) => rule.pattern.test(line));
    if (index >= 0) found.push({ rule, line: index + 1, excerpt: lines[index].trim().slice(0, 200) });
    else if (rule.pattern.test(text)) found.push({ rule, line: 0, excerpt: "" });
  }
  // The generic "build failed" line is only useful when nothing more specific matched.
  // Low-priority warnings are always kept, but ranked after every real error.
  const byLine = (a: Explanation, b: Explanation) => (a.line || 1e9) - (b.line || 1e9);
  const real = found.filter((f) => f.rule.id !== "build-command" && !f.rule.lowPriority).sort(byLine);
  const warnings = found.filter((f) => f.rule.lowPriority).sort(byLine);
  const generic = real.length ? [] : found.filter((f) => f.rule.id === "build-command");
  return [...real, ...generic, ...warnings];
}
