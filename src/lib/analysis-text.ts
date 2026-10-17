import type { Lang } from "@/lib/i18n";
import type { SecretKind } from "@/lib/secrets";
import type { CronField, CronIssue } from "@/lib/vercel-cron";

const EN_CRON_FIELDS: Record<CronField, string> = { minute: "minute", hour: "hour", dayOfMonth: "day of month", month: "month", dayOfWeek: "day of week" };
const SV_CRON_FIELDS: Record<CronField, string> = { minute: "minut", hour: "timme", dayOfMonth: "dag i månaden", month: "månad", dayOfWeek: "veckodag" };

export type AnalysisText = {
  titles: { nextEntry: string; imports: string; serverLibs: string; env: string; supabase: string; prisma: string; buildConfig: string; secrets: string; dependencies: string };
  noChange: string;
  partialFixToken: string;
  partialFixRetry: string;
  partialMessage: (read: number, found: number, rateLimited: boolean) => string;
  next: {
    unreadable: string; unreadableFix: string; missingFolder: string; missingFolderFix: string;
    noRouteEvidence: string; routeFound: string; found: string; notNext: string;
  };
  imports: {
    problem: (spec: string) => string; fix: (target: string, line: number) => string;
    caseProblem: (spec: string, actual: string) => string; caseFix: (exact: string, line: number) => string;
    summary: (n: number, cases: number) => string; ok: string; read: (n: number) => string;
  };
  server: {
    red: string; fix: string; write: (file: string) => string; partial: string; ok: string;
    edgeRed: (n: number) => string; edgeProblem: (module: string) => string;
    packageProblem: (name: string) => string; writeProblem: string;
    edgeFix: (module: string) => string; edgeMiddlewareFix: (module: string) => string;
  };
  env: {
    missing: (n: number, names: string) => string; exposed: (n: number, names: string) => string;
    fixMissing: (names: string) => string; fixExposed: string;
    missingProblem: (name: string) => string; missingFix: (name: string) => string;
    exposedProblem: (name: string) => string; exposedFix: (name: string) => string;
    evidenceMissing: (name: string) => string; evidenceExposed: (name: string) => string;
    gitignore: (rule: string) => string; gitignoreProblem: (rule: string) => string;
    gitignoreFix: (line: string) => string; evidenceGitignore: (rule: string) => string;
    misnamed: (file: string) => string; misnamedProblem: (file: string) => string;
    misnamedFix: (file: string) => string; evidenceMisnamed: (file: string) => string;
    optional: (n: number, names: string) => string; fixOptional: (names: string) => string;
    optionalProblem: (name: string) => string; optionalFix: (name: string) => string; evidenceOptional: (name: string) => string;
    partial: string; okUsed: string; okNone: string;
  };
  supabase: {
    serverBrowser: (file: string) => string; clientKey: (file: string) => string;
    red: string; fix: string; partial: string; ok: string;
    rlsMissing: (table: string) => string; rlsFix: (table: string) => string; rlsRed: (n: number) => string;
    grantsMissing: (table: string) => string; grantsFix: (sql: string) => string; grantsYellow: (n: number) => string;
    openPolicy: (policy: string, table: string, command: string) => string; openPolicyFix: string; openYellow: (n: number) => string;
  };
  deps: {
    missingRed: (name: string) => string; missingYellow: (name: string) => string; missingFix: (name: string, command: string) => string;
    red: (n: number) => string; yellow: (n: number) => string; partial: string; ok: string; okNotTraced: string;
    nativeMissing: (name: string) => string; nativeFix: string; nativeYellow: (n: number) => string;
    pnpmBuilds: (name: string) => string; pnpmBuildsFix: (names: string[]) => string; pnpmBuildsYellow: (n: number) => string;
    driftChanged: (name: string, wanted: string, lockfile: string, locked: string) => string;
    driftAdded: (name: string, lockfile: string) => string; driftRemoved: (name: string, lockfile: string) => string;
    pnpmRed: (n: number) => string; pnpmYellow: (n: number) => string; npmYellow: (n: number) => string; pnpmFix: string; npmFix: string;
  };
  secrets: {
    kinds: Record<SecretKind, string>; problem: (kind: string, masked: string) => string; fix: (kind: string) => string;
    red: (n: number) => string; summaryFix: string; partial: string; ok: string;
  };
  build: {
    lockfiles: (files: string) => string; lockfilesFix: (keep: string | undefined, files: string[]) => string;
    noBuild: string; noBuildFix: string; engines: (range: string) => string; enginesFix: string;
    framework: (value: string) => string; frameworkFix: string;
    indexCase: (file: string) => string; indexCaseFix: (file: string) => string;
    spaRewrite: (router: string) => string; spaRewriteFix: string;
    cronHobby: (schedule: string, path?: string) => string; cronHobbyFix: (daily: string) => string;
    cronInvalid: (schedule: string, reason: string, path?: string) => string; cronInvalidFix: string; cronReason: (issue: CronIssue) => string;
    cronCount: (n: number) => string; cronCountFix: string;
    maxDuration: (pattern: string, seconds: number) => string; maxDurationFix: string;
    memory: (pattern: string) => string; memoryFix: string;
    webpack: (major: number) => string; webpackFix: string; webpackPlugin: (major: number) => string; webpackPluginFix: string;
    exportDynamic: (route: string) => string; exportDynamicFix: string; exportDynamicRouteFix: string;
    exportRouteMethods: (methods: string) => string; exportRouteMethodsFix: string;
    exportRouteStatic: string; exportRouteStaticFix: string;
    exportProxy: string; exportProxyFix: string; exportAction: string; exportActionFix: string;
    exportIsr: (seconds: number) => string; exportIsrFix: string;
    exportApiRoute: string; exportApiRouteFix: string; exportGssp: string; exportGsspFix: string;
    remoteImage: (src: string, host: string) => string; remoteImageFix: (host: string) => string;
    svelteAdapter: (adapter: string, target: string) => string; svelteAdapterFix: (file: string) => string;
    svelteTargets: Record<string, string>;
    astroOutputNoAdapter: (output: string) => string; astroPrerenderNoAdapter: string; astroNoAdapterFix: string;
    astroOtherAdapter: (adapter: string) => string; astroOtherAdapterFix: (adapter: string) => string;
    red: (n: number) => string; yellow: (n: number) => string; ok: string; okAdapter: (framework: string) => string;
  };
  prisma: {
    okDrizzle: string; okNone: string; noGenerate: string; noGenerateFix: string;
    sqlite: string; sqliteFix: string; red: (n: number) => string; partial: string; ok: string;
  };
};

const en: AnalysisText = {
  titles: {
    nextEntry: "Next.js entrypoint", imports: "Broken imports", serverLibs: "Vercel-incompatible server code",
    env: "Environment variables", supabase: "Supabase server/client boundaries", prisma: "Prisma / database",
    buildConfig: "Build configuration", secrets: "Hardcoded secrets", dependencies: "Dependencies",
  },
  noChange: "No change is needed for this check.",
  partialFixToken: "Add GITHUB_TOKEN in Vercel > Settings > Environment Variables, redeploy and scan again.",
  partialFixRetry: "Scan again; large files and large repositories may need to be checked manually.",
  partialMessage: (read, found, rateLimited) =>
    `We read ${read} of ${found} files; then ${rateLimited ? "GitHub stopped us (rate limit)" : "we reached a file, time or read limit"}.`,
  next: {
    unreadable: "DeployDoctor could not read a valid root package.json, so it could not confirm the Next.js entrypoint.",
    unreadableFix: "Commit a valid package.json at the repository root or point deployment tooling at the application root.",
    missingFolder: "Next.js is declared in package.json, but the repository has no app/, pages/, src/app/, or src/pages/ folder.",
    missingFolderFix: "Add an App Router app/ directory with a root layout and page, or restore the Pages Router pages/ directory before deploying.",
    noRouteEvidence: "No Next.js route folder found",
    routeFound: "Route folder found",
    found: "✅ Next.js entrypoint found - no change needed",
    notNext: "The root package.json does not declare Next.js, so this Next.js-specific failure does not apply.",
  },
  imports: {
    problem: (spec) => `imports ${spec} which doesn't exist in the repository`,
    fix: (target, line) => `Add ${target} if the file exists locally, or change the import on line ${line} to the file's real location.`,
    caseProblem: (spec, actual) => `imports ${spec}, but the file is ${actual}; the letter case differs, which works on Mac and Windows but fails on Linux (Vercel)`,
    caseFix: (exact, line) => `Change the import on line ${line} to the exact file name: "${exact}".`,
    summary: (n, cases) => `${n} import${n === 1 ? "" : "s"} point to files that are missing from the GitHub repository${cases ? ` (${cases} only by letter case)` : ""}.`,
    ok: "Every relative and @/ import found resolves to a file in the repository tree.",
    read: (n) => `Read ${n} source files`,
  },
  server: {
    red: "The repository includes a heavyweight browser, SQLite binding, or API-route filesystem write that is unsafe for Vercel Functions.",
    fix: "Move browser work to an external worker, replace SQLite with a hosted database, and write generated files to object storage instead of the function filesystem.",
    write: (file) => `${file} → filesystem write`,
    partial: "No dangerous packages found so far, but we could not check every API route.",
    ok: "No Playwright, Puppeteer, SQLite binding, filesystem write in an API route, or Node-only import in Edge code was found.",
    edgeRed: (n) => `${n} import${n === 1 ? "" : "s"} in Edge runtime code need${n === 1 ? "s" : ""} Node.js, so the build or the function fails on Vercel.`,
    edgeProblem: (module) => `imports ${module}, which does not exist in the Edge runtime`,
    packageProblem: (name) => `depends on ${name}`,
    writeProblem: "writes to the filesystem in an API route",
    edgeFix: (module) => `Remove export const runtime = "edge" from the file (Node.js is the default), or move the ${module} code to a route that runs on Node.js.`,
    edgeMiddlewareFix: (module) => `Move the ${module} code out of middleware (it runs on the Edge runtime), or on Next.js 15.5+ add export const config = { runtime: "nodejs" }; on Next.js 16, rename middleware.ts to proxy.ts, which runs on Node.js.`,
  },
  env: {
    missing: (n, names) => `${n} env variable${n === 1 ? " is" : "s are"} missing from .env.example: ${names}`,
    exposed: (n, names) => `${n} possible secret${n === 1 ? " is" : "s are"} exposed in the browser: ${names}`,
    fixMissing: (names) => `Add empty lines to .env.example in the repository root: ${names}; push the file`,
    fixExposed: "remove NEXT_PUBLIC_ from the secrets and rotate any exposed keys",
    missingProblem: (name) => `${name} is missing from .env.example`,
    missingFix: (name) => `Add ${name}= (empty) to .env.example; set the value privately in Vercel.`,
    exposedProblem: (name) => `${name} may expose a secret`,
    exposedFix: (name) => `Use ${name} on the server only and rotate the old key.`,
    evidenceMissing: (name) => `${name} → missing from committed env template`,
    evidenceExposed: (name) => `${name} → potentially secret NEXT_PUBLIC_ variable`,
    gitignore: (rule) => `.gitignore ignores .env.example (rule "${rule}"), so the template cannot be committed`,
    gitignoreProblem: (rule) => `the rule "${rule}" makes git ignore .env.example`,
    gitignoreFix: (line) => `Add this line at the end of .gitignore: ${line}`,
    evidenceGitignore: (rule) => `.gitignore → "${rule}" ignores .env.example`,
    misnamed: (file) => `the env template is named ${file}, so Vercel, dotenv tools and new developers never find it`,
    misnamedProblem: (file) => `${file} is the env template, but the convention is .env.example in the repository root`,
    misnamedFix: (file) => `Rename ${file} to .env.example (git mv ${file} .env.example) and keep only NAME= lines in it`,
    evidenceMisnamed: (file) => `${file} → env template under a name tools do not look for`,
    optional: (n, names) => `${n} optional env variable${n === 1 ? " has" : "s have"} a fallback in the code but ${n === 1 ? "is" : "are"} not in .env.example: ${names}`,
    fixOptional: (names) => `Add the optional variables to .env.example as commented lines, so their fallbacks still apply: ${names}`,
    optionalProblem: (name) => `${name} has a fallback in the code but is not documented in .env.example`,
    optionalFix: (name) => `Add # ${name}= to .env.example as a commented line. Keep it commented: an empty ${name}= line can replace the fallback with an empty string.`,
    evidenceOptional: (name) => `${name} → optional, has a fallback in the code`,
    partial: "The env variables we read are documented, but the scan did not finish.",
    okUsed: "Every process.env variable found is documented and no secret-looking value uses NEXT_PUBLIC_.",
    okNone: "No process.env usage or browser-exposed secret was found.",
  },
  supabase: {
    serverBrowser: (file) => `${file} → browser Supabase client in server code`,
    clientKey: (file) => `${file} → service role key referenced by client code`,
    red: "Supabase browser credentials are used in server code or the service role key is referenced from a Client Component.",
    fix: "Use Supabase credentials only in server-only modules, and keep SUPABASE_SECRET_KEY or the legacy service role key out of Client Components.",
    partial: "No Supabase mix-up found, but the scan did not finish.",
    ok: "No Supabase browser client is used in server code and no service role key is referenced in client code.",
    rlsMissing: (table) => `public.${table} has no row level security in the migrations, so anyone with the anon key can read and change every row through the Data API`,
    rlsFix: (table) => `Add a migration with alter table public.${table} enable row level security; and then policies for the rows each role may see. With RLS on and no policy, the Data API returns no rows.`,
    rlsRed: (n) => `${n} table${n === 1 ? " has" : "s have"} no row level security.`,
    grantsMissing: (table) => `public.${table} is created without a GRANT to anon, authenticated or service_role; Supabase is removing the automatic grants on new tables, and where that default applies the Data API answers 42501 permission denied`,
    grantsFix: (sql) => `Add a migration that grants only what each role needs, for example:\n${sql}\nKeep row level security on: grants decide which roles reach the table, policies decide which rows.`,
    grantsYellow: (n) => `${n} table${n === 1 ? " has" : "s have"} no Data API grants in the migrations and will answer 42501 once the automatic grants are gone.`,
    openPolicy: (policy, table, command) => `policy ${policy} on public.${table} lets anyone ${({ all: "read and change", insert: "insert", update: "update", delete: "delete" } as Record<string, string>)[command] ?? command} rows with no condition`,
    openPolicyFix: "Limit the policy to the role that needs it, such as to authenticated, and give it a real condition, for example using ((select auth.uid()) = user_id). Keep true only for data meant to be public.",
    openYellow: (n) => `${n} polic${n === 1 ? "y lets" : "ies let"} anyone write without a condition.`,
  },
  deps: {
    missingRed: (name) => `imports ${name}, which is in neither package.json nor the lockfile, so Vercel never installs it and the build fails`,
    missingYellow: (name) => `imports ${name}, which is not in package.json; it only works if another package happens to install it`,
    missingFix: (name, command) => `Add ${name} to package.json: run ${command} and commit package.json and the lockfile.`,
    red: (n) => `${n} package${n === 1 ? " is" : "s are"} imported by the build but never installed on Vercel.`,
    yellow: (n) => `${n} dependenc${n === 1 ? "y relies" : "ies rely"} on luck: the build may install something other than what you tested.`,
    partial: "No dependency problems in the files we read, but the scan did not finish.",
    ok: "Every package the Next.js build imports is declared in package.json, and the lockfile matches it.",
    okNotTraced: "No dependency problems found. Imports are traced for a Next.js app at the repository root.",
    nativeMissing: (name) => `package-lock.json has ${name} for macOS or Windows but not its Linux x64 binary; npm ci on Vercel installs exactly the lockfile, so anything that loads ${name} fails with Cannot find module`,
    nativeFix: "Delete package-lock.json and node_modules, run npm install, check that package-lock.json now has a linux-x64 entry for the package, and commit it. If it still does not, add that entry to optionalDependencies in package.json.",
    nativeYellow: (n) => `${n} native package${n === 1 ? " is missing its Linux binary" : "s are missing their Linux binaries"} in package-lock.json, a known npm bug when the lockfile is written on macOS or Windows.`,
    pnpmBuilds: (name) => `${name} needs its install script to get its native binary, and pnpm 10 skips the install scripts of dependencies that are not allowed; if Vercel installs with pnpm 10, ${name} fails to load with a missing binding error`,
    pnpmBuildsFix: (names) => `Allow the build in package.json: "pnpm": { "onlyBuiltDependencies": [${names.map((name) => `"${name}"`).join(", ")}] }. Run pnpm install and commit package.json and pnpm-lock.yaml. Running pnpm approve-builds locally does the same.`,
    pnpmBuildsYellow: (n) => `${n} package${n === 1 ? " needs" : "s need"} an install script that pnpm 10 does not run unless the package is allowed.`,
    driftChanged: (name, wanted, lockfile, locked) => `package.json asks for ${name} "${wanted}", but ${lockfile} has "${locked}"`,
    driftAdded: (name, lockfile) => `${name} is in package.json but not in ${lockfile}`,
    driftRemoved: (name, lockfile) => `${name} is still in ${lockfile} but no longer in package.json`,
    pnpmRed: (n) => `pnpm-lock.yaml does not match package.json (${n} difference${n === 1 ? "" : "s"}); Vercel installs with a frozen lockfile, so the install stops with ERR_PNPM_OUTDATED_LOCKFILE.`,
    pnpmYellow: (n) => `pnpm-lock.yaml does not match package.json (${n} difference${n === 1 ? "" : "s"}). vercel.json sets its own installCommand, so the install may or may not stop, but the lockfile is out of date either way.`,
    npmYellow: (n) => `package-lock.json does not match package.json (${n} difference${n === 1 ? "" : "s"}), so npm rewrites it during the build and Vercel may install other versions than you tested.`,
    pnpmFix: "Run pnpm install locally and commit the updated pnpm-lock.yaml.",
    npmFix: "Run npm install locally and commit the updated package-lock.json.",
  },
  secrets: {
    kinds: {
      "stripe-secret": "Stripe live secret key", "stripe-restricted": "Stripe live restricted key", "stripe-webhook": "Stripe webhook signing secret",
      "aws-access-key": "AWS access key", "github-token": "GitHub token", "supabase-secret": "Supabase secret key", "private-key": "private key",
    },
    problem: (kind, masked) => `contains a ${kind} (${masked})`,
    fix: (kind) => `Revoke the ${kind} now and create a new one, since anyone who can read the repository can use it. Then delete it from the file, read it from process.env instead and set the value in Vercel > Settings > Environment Variables.`,
    red: (n) => `${n} hardcoded secret${n === 1 ? " is" : "s are"} committed in the current files; anyone who can read the repository can use ${n === 1 ? "it" : "them"}.`,
    summaryFix: "Revoke and replace each key first, then move it out of the code into an environment variable set in Vercel. Removing it from the file alone is not enough: the old value stays in git history.",
    partial: "No secrets found in the files we read, but the scan did not finish.",
    ok: "No live Stripe, AWS, GitHub or Supabase secret key and no private key was found in the files we read.",
  },
  build: {
    lockfiles: (files) => `has lockfiles for more than one package manager (${files}); Vercel picks one and may install different versions than you tested`,
    lockfilesFix: (keep, files) => keep
      ? `Keep the ${keep} lockfile (package.json says packageManager ${keep}) and delete the others: ${files.join(", ")}.`
      : `Pick one package manager, keep its lockfile and delete the others: ${files.join(", ")}.`,
    noBuild: "declares next but has no build script",
    noBuildFix: 'Add "build": "next build" under scripts in package.json so npm run build works locally and on every host.',
    engines: (range) => `engines.node is "${range}", which allows none of Node 20, 22 or 24 that Vercel builds with`,
    enginesFix: 'Change engines.node in package.json to a range Vercel supports, for example ">=20" or "22.x".',
    framework: (value) => `vercel.json sets framework to ${value}, so Vercel does not run Next.js routing for this app; the build passes and every URL can return 404 NOT_FOUND`,
    frameworkFix: 'Set "framework": "nextjs" in vercel.json. If you remove the line instead, check that Framework Preset is Next.js under Project Settings, Build and Deployment, then redeploy.',
    indexCase: (file) => `the home page is ${file}, but Vercel serves index.html in lower case for /, so the site returns 404 NOT_FOUND on Linux`,
    indexCaseFix: (file) => `Rename ${file} to index.html. Git ignores a rename that only changes case on macOS and Windows, so rename it in two steps through a temporary name.`,
    spaRewrite: (router) => `this Vite app routes in the browser with ${router}, but vercel.json has no rewrite to index.html, so opening or reloading any page other than / returns 404 NOT_FOUND`,
    spaRewriteFix: 'Add a rewrite to vercel.json at the repository root: "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]. If vercel.json sets cleanUrls, use / as the destination. Redeploy and reload a deep link to confirm.',
    cronHobby: (schedule, path) => `the cron job${path ? ` for ${path}` : ""} runs on ${schedule}, which is more than once a day; on the Hobby plan Vercel fails the deployment, because Hobby only allows cron jobs that run once a day`,
    cronHobbyFix: (daily) => `On the Hobby plan, run it once a day instead, for example ${daily}. Times are UTC, and on Hobby the job can start any time within that hour. If it has to run more often, move the project to Pro, where cron jobs can run as often as once a minute.`,
    cronInvalid: (schedule, reason, path) => `the cron job${path ? ` for ${path}` : ""} has the schedule ${schedule}, which is not a valid Vercel cron expression: ${reason}`,
    cronInvalidFix: "Write the schedule as five numeric fields in UTC: minute 0 to 59, hour 0 to 23, day of month 1 to 31, month 1 to 12 and day of week 0 to 6 (Sunday is 0), with * in day of month or in day of week. For example, 0 5 * * * runs every day at 05:00 UTC.",
    cronReason: (issue) => issue.kind === "fields" ? `it has ${issue.count} field${issue.count === 1 ? "" : "s"}, and Vercel expects five: minute, hour, day of month, month and day of week`
      : issue.kind === "names" ? `Vercel does not support names such as ${issue.token}, so use numbers: 0 to 6 for Sunday to Saturday and 1 to 12 for January to December`
      : issue.kind === "range" ? `${issue.value} is outside ${issue.min} to ${issue.max}, the range for ${EN_CRON_FIELDS[issue.field]}`
      : issue.kind === "syntax" ? `${issue.text} in the ${EN_CRON_FIELDS[issue.field]} field is not a number, *, a range, a step or a list`
      : "it sets both day of month and day of week, and Vercel needs one of them to be *",
    cronCount: (n) => `vercel.json defines ${n} cron jobs, and Vercel allows at most 100 per project on every plan`,
    cronCountFix: "Bring the list down to 100 cron jobs or fewer, for example by letting one route run several tasks that share a schedule.",
    maxDuration: (pattern, seconds) => `the functions entry ${pattern} sets maxDuration to ${seconds} seconds, above the 300 seconds the Hobby plan allows; Vercel only accepts a value from 1 up to your plan's maximum`,
    maxDurationFix: "On the Hobby plan, lower maxDuration to 300 or set it to max, which Vercel turns into your plan's maximum at deploy time. Pro allows up to 800 seconds, and up to 1800 seconds in beta for some Node.js, Bun and Python runtimes.",
    memory: (pattern) => `the functions entry ${pattern} sets memory, which Vercel does not read from vercel.json with Fluid compute, the default for new projects; the build only prints a warning and the function keeps the project memory size`,
    memoryFix: "Remove memory from vercel.json. On Pro and Enterprise, set the memory size in the project under Settings, Functions. On Hobby every function always gets the default 2 GB.",
    webpack: (major) => `sets a custom webpack config, but Next.js ${major} runs next build with Turbopack by default, and the Next.js 16 upgrade guide says the build will then fail to prevent misconfiguration issues`,
    webpackFix: "Pick one of the ways the Next.js 16 upgrade guide gives: keep Webpack with next build --webpack in the build script, build with Turbopack and ignore the webpack config with next build --turbopack, or move the settings to the turbopack option in next.config. With --turbopack, what the webpack function changed no longer applies, so test the app after the build.",
    exportDynamic: (route) => `${route} is a dynamic route without generateStaticParams, and next.config sets output to export, where every dynamic route must be rendered at build time; next build stops with an error that the page is missing generateStaticParams()`,
    webpackPlugin: (major) => `sets a custom webpack config with no turbopack option, which makes Next.js ${major} stop next build, but next.config passes its config through a plugin, a function or a spread that may add a turbopack option when the config loads, as @next/mdx and next-intl do, and then the build passes`,
    webpackPluginFix: "Run next build on your machine. If it stops with This build is using Turbopack, with a webpack config and no turbopack config, use one of the ways the Next.js 16 upgrade guide gives: next build --webpack in the build script, next build --turbopack, or a turbopack option in next.config. If it passes, the plugin adds the option and nothing needs to change.",
    exportDynamicFix: "Export generateStaticParams from the page or a parent layout and return one params object for each page to build, with a value for every dynamic segment. If the paths cannot be known at build time, remove output: export from next.config so Vercel renders the route on request.",
    exportDynamicRouteFix: "Export generateStaticParams from this route file and return one params object for each path to build, with a value for every dynamic segment; a route handler does not take it from a layout. If the paths cannot be known at build time, remove output: export from next.config so Vercel runs the route handler as a function.",
    exportRouteMethods: (methods) => `exports ${methods}, but with output set to export in next.config Next.js only supports GET route handlers, and the exported site is plain files with no server to answer other methods`,
    exportRouteMethodsFix: "Remove output: export from next.config so Vercel runs the route handler as a function, or send these requests to an API that runs somewhere else.",
    exportRouteStatic: "has a GET route handler that is not marked static, so with output set to export in next.config, next build stops with an error that export const dynamic = force-static or export const revalidate is not configured on this route",
    exportRouteStaticFix: 'Add export const dynamic = "force-static" to the file if the response can be built once at build time. If the handler reads the request, such as headers, cookies or search params, it cannot be part of a static export: remove output: export from next.config instead.',
    exportProxy: "runs on incoming requests, but a static export (output set to export in next.config) does not support Proxy or middleware, because they need the incoming request, so this file does not run on the exported site",
    exportProxyFix: "Move redirects, rewrites and headers to vercel.json and other logic into the pages, or remove output: export from next.config so Vercel runs the app with a server.",
    exportAction: "defines a Server Action with use server, and Server Actions are not supported in a static export (output set to export in next.config): the exported site has no server to run them",
    exportActionFix: "Call an API from the client instead of the Server Action, or remove output: export from next.config so Vercel can run Server Actions.",
    exportIsr: (seconds) => `sets revalidate to ${seconds}, but Incremental Static Regeneration is not supported in a static export (output set to export in next.config), so the page is only built once`,
    exportIsrFix: "Remove revalidate and redeploy when the content changes, or remove output: export from next.config to use ISR on Vercel.",
    exportApiRoute: "is a Pages Router API route, and API Routes cannot be used with a static export (output set to export in next.config)",
    exportApiRouteFix: "Remove output: export from next.config so Vercel runs the API route as a function, or move the endpoint to an API that runs somewhere else.",
    exportGssp: "uses getServerSideProps, which is not supported in a static export (output set to export in next.config)",
    exportGsspFix: "Use getStaticProps or fetch the data on the client, or remove output: export from next.config so Vercel renders the page on request.",
    remoteImage: (src, host) => `next/image loads ${src}, but ${host} is not in images.remotePatterns or images.domains in next.config; the Next.js image optimizer answers 400 Bad Request for a host that does not match, so the image does not show, and next dev throws Invalid src prop with hostname ${host} is not configured under images`,
    remoteImageFix: (host) => `Allow the host in next.config with images: { remotePatterns: [new URL("https://${host}/**")] }, narrowed to the path you use if you can, and redeploy. If the image does not need optimizing, add the unoptimized prop to this Image instead.`,
    svelteAdapter: (adapter, target) => `configures ${adapter}, which builds the app for ${target}, not for Vercel; the SvelteKit docs say that to deploy to Vercel you use adapter-vercel`,
    svelteAdapterFix: (file) => `Install @sveltejs/adapter-vercel as a dev dependency, import the adapter from it in ${file} instead and redeploy. @sveltejs/adapter-auto also works on Vercel: it detects Vercel and installs adapter-vercel at build time, but Vercel recommends installing adapter-vercel yourself for version stability.`,
    svelteTargets: { node: "a standalone Node server started with node build", netlify: "Netlify", cloudflare: "Cloudflare", "cloudflare-workers": "Cloudflare Workers", bun: "a Bun server" },
    astroOutputNoAdapter: (output) => `sets output to ${output}, which renders pages on demand, but has no adapter, so astro build stops with NoAdapterInstalled: Cannot use server-rendered pages without an adapter`,
    astroPrerenderNoAdapter: "sets prerender to false, which renders this route on demand, but the project has no Astro adapter, so astro build stops with NoAdapterInstalled: Cannot use server-rendered pages without an adapter",
    astroNoAdapterFix: "Run npx astro add vercel, which installs @astrojs/vercel and adds adapter: vercel() to astro.config, then redeploy. A fully static Astro site needs no adapter on Vercel, so removing the on-demand rendering also works.",
    astroOtherAdapter: (adapter) => `renders pages on demand with ${adapter}, but the Vercel docs for Astro say a server-rendered Astro app must use Astro's Vercel adapter, @astrojs/vercel`,
    astroOtherAdapterFix: (adapter) => `Run npx astro add vercel, remove ${adapter} from astro.config and package.json, and redeploy.`,
    red: (n) => `${n} project setting${n === 1 ? " stops" : "s stop"} the Vercel build.`,
    yellow: (n) => `${n} project setting${n === 1 ? "" : "s"} may make the Vercel build behave differently from your machine.`,
    ok: "One lockfile, a build script and a Node version Vercel supports.",
    okAdapter: (framework) => `One lockfile, a build script, a Node version Vercel supports and no ${framework} adapter problem.`,
  },
  prisma: {
    okDrizzle: "Drizzle found. SQLite drivers are caught by the Vercel-incompatible server code check.",
    okNone: "Neither Prisma nor Drizzle was found in package.json, so there is nothing to check.",
    noGenerate: "does not run prisma generate on install or build",
    noGenerateFix: 'Add "postinstall": "prisma generate" under scripts in package.json; Vercel caches node_modules, so Prisma Client goes stale otherwise.',
    sqlite: "uses SQLite, which does not work on Vercel Functions",
    sqliteFix: "Switch the provider to a hosted database (for example postgresql) and set DATABASE_URL in Vercel.",
    red: (n) => `${n} Prisma issue${n === 1 ? "" : "s"} could break the build or the database on Vercel.`,
    partial: "No Prisma issues found in what we read, but the scan did not finish.",
    ok: "prisma generate runs at build time and no SQLite database was found.",
  },
};

const sv: AnalysisText = {
  titles: {
    nextEntry: "Next.js-startpunkt", imports: "Trasiga importer", serverLibs: "Vercel-inkompatibel serverkod",
    env: "Miljövariabler", supabase: "Supabase-gränser mellan server och klient", prisma: "Prisma / databas",
    buildConfig: "Byggkonfiguration", secrets: "Hårdkodade hemligheter", dependencies: "Beroenden",
  },
  noChange: "Ingen ändring behövs för den här kontrollen.",
  partialFixToken: "Lägg till GITHUB_TOKEN i Vercel > Settings > Environment Variables, deploya om och skanna igen.",
  partialFixRetry: "Skanna igen; stora filer och stora repon kan behöva kontrolleras manuellt.",
  partialMessage: (read, found, rateLimited) =>
    `Vi läste ${read} av ${found} filer; sedan ${rateLimited ? "stoppade GitHub oss (rate limit)" : "nådde vi en fil-, tids- eller läsgräns"}.`,
  next: {
    unreadable: "DeployDoctor kunde inte läsa en giltig package.json i roten, så Next.js-startpunkten kunde inte bekräftas.",
    unreadableFix: "Committa en giltig package.json i repots rot, eller peka deploy-verktyget på applikationens rotmapp.",
    missingFolder: "Next.js finns i package.json, men repot saknar mapparna app/, pages/, src/app/ och src/pages/.",
    missingFolderFix: "Lägg till en App Router-mapp app/ med root layout och page, eller återställ Pages Router-mappen pages/ innan du deployar.",
    noRouteEvidence: "Ingen Next.js-routemapp hittades",
    routeFound: "Routemapp hittades",
    found: "✅ Next.js-startpunkt hittades - ingen ändring behövs",
    notNext: "Rotens package.json deklarerar inte Next.js, så det här Next.js-felet gäller inte.",
  },
  imports: {
    problem: (spec) => `importerar ${spec}, som inte finns i repot`,
    fix: (target, line) => `Lägg till ${target} om filen finns lokalt, eller ändra importen på rad ${line} till filens riktiga plats.`,
    caseProblem: (spec, actual) => `importerar ${spec}, men filen heter ${actual}; stora och små bokstäver skiljer sig, vilket fungerar på Mac och Windows men kraschar på Linux (Vercel)`,
    caseFix: (exact, line) => `Byt importen på rad ${line} till exakt filnamn: "${exact}".`,
    summary: (n, cases) => `${n} import${n === 1 ? "" : "er"} pekar på filer som saknas i GitHub-repot${cases ? ` (${cases} bara på grund av stora och små bokstäver)` : ""}.`,
    ok: "Alla relativa importer och @/-importer som hittades pekar på en fil i repots filträd.",
    read: (n) => `Läste ${n} källfiler`,
  },
  server: {
    red: "Repot innehåller en tung webbläsare, en SQLite-koppling eller filsystemsskrivning i en API-route, vilket inte fungerar i Vercel Functions.",
    fix: "Flytta webbläsararbete till en extern worker, ersätt SQLite med en hostad databas och skriv genererade filer till objektlagring i stället för funktionens filsystem.",
    write: (file) => `${file} → filsystemsskrivning`,
    partial: "Inga farliga paket hittade hittills, men vi kunde inte kolla alla API-routes.",
    ok: "Ingen Playwright, Puppeteer, SQLite-koppling, filsystemsskrivning i en API-route eller Node-import i Edge-kod hittades.",
    edgeRed: (n) => `${n} import${n === 1 ? "" : "er"} i kod som kör i Edge runtime kräver Node.js, så bygget eller funktionen kraschar på Vercel.`,
    edgeProblem: (module) => `importerar ${module}, som inte finns i Edge runtime`,
    packageProblem: (name) => `är beroende av ${name}`,
    writeProblem: "skriver till filsystemet i en API-route",
    edgeFix: (module) => `Ta bort export const runtime = "edge" från filen (Node.js är standard), eller flytta koden som använder ${module} till en route som kör på Node.js.`,
    edgeMiddlewareFix: (module) => `Flytta koden som använder ${module} ut ur middleware (den kör i Edge runtime), eller lägg till export const config = { runtime: "nodejs" } på Next.js 15.5+; på Next.js 16 kan du döpa om middleware.ts till proxy.ts, som kör på Node.js.`,
  },
  env: {
    missing: (n, names) => `${n} env-variabler saknas i .env.example: ${names}`,
    exposed: (n, names) => `${n} möjliga hemligheter exponeras i webbläsaren: ${names}`,
    fixMissing: (names) => `Lägg till tomma rader i .env.example i root: ${names}; pusha filen`,
    fixExposed: "ta bort NEXT_PUBLIC_ från hemligheterna och rotera exponerade nycklar",
    missingProblem: (name) => `${name} saknas i .env.example`,
    missingFix: (name) => `Lägg till ${name}= (tomt) i .env.example; sätt värdet privat i Vercel.`,
    exposedProblem: (name) => `${name} kan exponera en hemlighet`,
    exposedFix: (name) => `Använd ${name} enbart på servern och rotera den gamla nyckeln.`,
    evidenceMissing: (name) => `${name} → saknas i den committade env-mallen`,
    evidenceExposed: (name) => `${name} → möjligen hemlig NEXT_PUBLIC_-variabel`,
    gitignore: (rule) => `.gitignore ignorerar .env.example (regeln "${rule}"), så mallen kan inte committas`,
    gitignoreProblem: (rule) => `regeln "${rule}" gör att git ignorerar .env.example`,
    gitignoreFix: (line) => `Lägg till den här raden sist i .gitignore: ${line}`,
    evidenceGitignore: (rule) => `.gitignore → "${rule}" ignorerar .env.example`,
    misnamed: (file) => `env-mallen heter ${file}, så Vercel, dotenv-verktyg och nya utvecklare hittar den aldrig`,
    misnamedProblem: (file) => `${file} är env-mallen, men konventionen är .env.example i repots root`,
    misnamedFix: (file) => `Döp om ${file} till .env.example (git mv ${file} .env.example) och behåll bara NAMN=-rader i den`,
    evidenceMisnamed: (file) => `${file} → env-mall under ett namn som verktyg inte letar efter`,
    optional: (n, names) => `${n} ${n === 1 ? "valfri env-variabel" : "valfria env-variabler"} har ett reservvärde i koden men saknas i .env.example: ${names}`,
    fixOptional: (names) => `Lägg till de valfria variablerna i .env.example som utkommenterade rader, så att reservvärdena fortfarande gäller: ${names}`,
    optionalProblem: (name) => `${name} har ett reservvärde i koden men är inte dokumenterad i .env.example`,
    optionalFix: (name) => `Lägg till # ${name}= som en utkommenterad rad i .env.example. Låt den vara utkommenterad: en tom ${name}=-rad kan ersätta reservvärdet med en tom sträng.`,
    evidenceOptional: (name) => `${name} → valfri, har ett reservvärde i koden`,
    partial: "De env-variabler vi läste är dokumenterade, men skanningen blev inte klar.",
    okUsed: "Alla process.env-variabler som hittades är dokumenterade och inget hemligt-liknande värde använder NEXT_PUBLIC_.",
    okNone: "Ingen process.env-användning eller webbläsarexponerad hemlighet hittades.",
  },
  supabase: {
    serverBrowser: (file) => `${file} → Supabase-webbläsarklient i serverkod`,
    clientKey: (file) => `${file} → service role-nyckel refereras i klientkod`,
    red: "Supabase-webbläsaruppgifter används i serverkod, eller service role-nyckeln refereras från en Client Component.",
    fix: "Använd Supabase-uppgifter bara i server-only-moduler, och håll SUPABASE_SECRET_KEY eller den gamla service role-nyckeln borta från Client Components.",
    partial: "Ingen Supabase-förväxling hittad, men skanningen blev inte klar.",
    ok: "Ingen Supabase-webbläsarklient används i serverkod och ingen service role-nyckel refereras i klientkod.",
    rlsMissing: (table) => `public.${table} saknar row level security i migreringarna, så vem som helst med anon-nyckeln kan läsa och ändra varje rad via Data API`,
    rlsFix: (table) => `Lägg till en migrering med alter table public.${table} enable row level security; och sedan policys för de rader varje roll får se. Med RLS på och ingen policy ger Data API inga rader.`,
    rlsRed: (n) => `${n} tabell${n === 1 ? "" : "er"} saknar row level security.`,
    grantsMissing: (table) => `public.${table} skapas utan GRANT till anon, authenticated eller service_role; Supabase tar bort de automatiska rättigheterna på nya tabeller, och där det gäller svarar Data API med 42501 permission denied`,
    grantsFix: (sql) => `Lägg till en migrering som bara ger varje roll det den behöver, till exempel:\n${sql}\nBehåll row level security: rättigheter styr vilka roller som når tabellen, policys styr vilka rader.`,
    grantsYellow: (n) => `${n} tabell${n === 1 ? "" : "er"} saknar rättigheter för Data API i migreringarna och svarar 42501 när de automatiska rättigheterna försvinner.`,
    openPolicy: (policy, table, command) => `policyn ${policy} på public.${table} låter vem som helst ${({ all: "läsa och ändra", insert: "lägga till", update: "uppdatera", delete: "ta bort" } as Record<string, string>)[command] ?? command} rader utan villkor`,
    openPolicyFix: "Begränsa policyn till rollen som behöver den, till exempel to authenticated, och ge den ett riktigt villkor, till exempel using ((select auth.uid()) = user_id). Behåll true bara för data som ska vara publik.",
    openYellow: (n) => `${n} policy${n === 1 ? "" : "s"} låter vem som helst skriva utan villkor.`,
  },
  deps: {
    missingRed: (name) => `importerar ${name}, som varken finns i package.json eller i lockfilen, så Vercel installerar det aldrig och bygget kraschar`,
    missingYellow: (name) => `importerar ${name}, som inte finns i package.json; det fungerar bara om ett annat paket råkar installera det`,
    missingFix: (name, command) => `Lägg till ${name} i package.json: kör ${command} och committa package.json och lockfilen.`,
    red: (n) => `${n} paket importeras av bygget men installeras aldrig på Vercel.`,
    yellow: (n) => `${n} beroende${n === 1 ? "" : "n"} bygger på tur: bygget kan installera något annat än det du testat.`,
    partial: "Inga beroendeproblem i filerna vi läste, men skanningen blev inte klar.",
    ok: "Alla paket som Next.js-bygget importerar finns i package.json, och lockfilen stämmer med den.",
    okNotTraced: "Inga beroendeproblem hittades. Importer följs för en Next.js-app i repots rot.",
    nativeMissing: (name) => `package-lock.json har ${name} för macOS eller Windows men inte dess Linux x64-binär; npm ci på Vercel installerar exakt lockfilen, så allt som laddar ${name} faller med Cannot find module`,
    nativeFix: "Ta bort package-lock.json och node_modules, kör npm install, kontrollera att package-lock.json nu har en linux-x64-post för paketet och committa den. Saknas den fortfarande, lägg till den posten under optionalDependencies i package.json.",
    nativeYellow: (n) => `${n} ${n === 1 ? "inbyggt paket saknar sin" : "inbyggda paket saknar sina"} Linux-binär${n === 1 ? "" : "er"} i package-lock.json, ett känt npm-fel när lockfilen skrivs på macOS eller Windows.`,
    pnpmBuilds: (name) => `${name} behöver sitt installationsskript för att hämta sin inbyggda binär, och pnpm 10 hoppar över installationsskript för beroenden som inte är tillåtna; installerar Vercel med pnpm 10 går ${name} inte att ladda och ger ett fel om saknad binding`,
    pnpmBuildsFix: (names) => `Tillåt bygget i package.json: "pnpm": { "onlyBuiltDependencies": [${names.map((name) => `"${name}"`).join(", ")}] }. Kör pnpm install och committa package.json och pnpm-lock.yaml. pnpm approve-builds lokalt gör samma sak.`,
    pnpmBuildsYellow: (n) => `${n} paket behöver ett installationsskript som pnpm 10 inte kör om paketet inte är tillåtet.`,
    driftChanged: (name, wanted, lockfile, locked) => `package.json vill ha ${name} "${wanted}", men ${lockfile} har "${locked}"`,
    driftAdded: (name, lockfile) => `${name} finns i package.json men inte i ${lockfile}`,
    driftRemoved: (name, lockfile) => `${name} finns kvar i ${lockfile} men inte längre i package.json`,
    pnpmRed: (n) => `pnpm-lock.yaml stämmer inte med package.json (${n} skillnad${n === 1 ? "" : "er"}); Vercel installerar med fryst lockfil, så installationen stoppas med ERR_PNPM_OUTDATED_LOCKFILE.`,
    pnpmYellow: (n) => `pnpm-lock.yaml stämmer inte med package.json (${n} skillnad${n === 1 ? "" : "er"}). vercel.json anger ett eget installCommand, så installationen stoppas kanske inte, men lockfilen är inaktuell oavsett.`,
    npmYellow: (n) => `package-lock.json stämmer inte med package.json (${n} skillnad${n === 1 ? "" : "er"}), så npm skriver om den under bygget och Vercel kan installera andra versioner än de du testat.`,
    pnpmFix: "Kör pnpm install lokalt och committa den uppdaterade pnpm-lock.yaml.",
    npmFix: "Kör npm install lokalt och committa den uppdaterade package-lock.json.",
  },
  secrets: {
    kinds: {
      "stripe-secret": "hemlig Stripe-nyckel (live)", "stripe-restricted": "begränsad Stripe-nyckel (live)", "stripe-webhook": "Stripe webhook-hemlighet",
      "aws-access-key": "AWS-åtkomstnyckel", "github-token": "GitHub-token", "supabase-secret": "hemlig Supabase-nyckel", "private-key": "privat nyckel",
    },
    problem: (kind, masked) => `innehåller en ${kind} (${masked})`,
    fix: (kind) => `Återkalla ${kind} nu och skapa en ny, eftersom alla som kan läsa repot kan använda den. Ta sedan bort den från filen, läs den från process.env i stället och sätt värdet i Vercel > Settings > Environment Variables.`,
    red: (n) => `${n} hårdkodade hemlighet${n === 1 ? " är" : "er är"} committade i de nuvarande filerna; alla som kan läsa repot kan använda ${n === 1 ? "den" : "dem"}.`,
    summaryFix: "Återkalla och ersätt varje nyckel först, och flytta den sedan från koden till en miljövariabel i Vercel. Det räcker inte att ta bort den från filen: det gamla värdet finns kvar i git-historiken.",
    partial: "Inga hemligheter hittades i filerna vi läste, men skanningen blev inte klar.",
    ok: "Ingen hemlig live-nyckel för Stripe, AWS, GitHub eller Supabase och ingen privat nyckel hittades i filerna vi läste.",
  },
  build: {
    lockfiles: (files) => `har lockfiler för mer än en pakethanterare (${files}); Vercel väljer en och kan installera andra versioner än de du testat`,
    lockfilesFix: (keep, files) => keep
      ? `Behåll lockfilen för ${keep} (package.json anger packageManager ${keep}) och ta bort de andra: ${files.join(", ")}.`
      : `Välj en pakethanterare, behåll dess lockfil och ta bort de andra: ${files.join(", ")}.`,
    noBuild: "har next som beroende men inget build-skript",
    noBuildFix: 'Lägg till "build": "next build" under scripts i package.json så att npm run build fungerar lokalt och hos alla värdar.',
    engines: (range) => `engines.node är "${range}", vilket inte tillåter någon av Node 20, 22 eller 24 som Vercel bygger med`,
    enginesFix: 'Ändra engines.node i package.json till ett intervall som Vercel stöder, t.ex. ">=20" eller "22.x".',
    framework: (value) => `vercel.json sätter framework till ${value}, så Vercel kör inte Next.js-routningen för appen; bygget går igenom men alla adresser kan ge 404 NOT_FOUND`,
    frameworkFix: 'Sätt "framework": "nextjs" i vercel.json. Tar du bort raden i stället, kontrollera att Framework Preset är Next.js under Project Settings, Build and Deployment, och driftsätt igen.',
    indexCase: (file) => `startsidan heter ${file}, men Vercel visar index.html med små bokstäver för /, så sajten ger 404 NOT_FOUND på Linux`,
    indexCaseFix: (file) => `Döp om ${file} till index.html. Git ignorerar ett namnbyte som bara ändrar skiftläge på macOS och Windows, så byt namn i två steg via ett tillfälligt namn.`,
    spaRewrite: (router) => `Vite-appen routar i webbläsaren med ${router}, men vercel.json har ingen rewrite till index.html, så den som öppnar eller laddar om en annan sida än / får 404 NOT_FOUND`,
    spaRewriteFix: 'Lägg till en rewrite i vercel.json i repots rot: "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]. Sätter vercel.json cleanUrls, använd / som destination. Driftsätt igen och ladda om en djuplänk för att bekräfta.',
    cronHobby: (schedule, path) => `cron-jobbet${path ? ` för ${path}` : ""} körs enligt ${schedule}, alltså mer än en gång per dag; på Hobby-planen misslyckas deployen, eftersom Hobby bara tillåter cron-jobb som körs en gång per dag`,
    cronHobbyFix: (daily) => `På Hobby-planen, kör jobbet en gång per dag i stället, till exempel ${daily}. Tiderna är UTC, och på Hobby kan jobbet starta när som helst under den timmen. Måste det köras oftare, flytta projektet till Pro, där cron-jobb kan köras så ofta som en gång i minuten.`,
    cronInvalid: (schedule, reason, path) => `cron-jobbet${path ? ` för ${path}` : ""} har schemat ${schedule}, som inte är ett giltigt cron-uttryck för Vercel: ${reason}`,
    cronInvalidFix: "Skriv schemat som fem numeriska fält i UTC: minut 0 till 59, timme 0 till 23, dag i månaden 1 till 31, månad 1 till 12 och veckodag 0 till 6 (söndag är 0), med * i dag i månaden eller i veckodag. Till exempel kör 0 5 * * * varje dag klockan 05:00 UTC.",
    cronReason: (issue) => issue.kind === "fields" ? `det har ${issue.count} fält, och Vercel förväntar sig fem: minut, timme, dag i månaden, månad och veckodag`
      : issue.kind === "names" ? `Vercel stöder inte namn som ${issue.token}, så använd siffror: 0 till 6 för söndag till lördag och 1 till 12 för januari till december`
      : issue.kind === "range" ? `${issue.value} ligger utanför ${issue.min} till ${issue.max}, intervallet för ${SV_CRON_FIELDS[issue.field]}`
      : issue.kind === "syntax" ? `${issue.text} i fältet för ${SV_CRON_FIELDS[issue.field]} är varken ett tal, *, ett intervall, ett steg eller en lista`
      : "det anger både dag i månaden och veckodag, och Vercel kräver att en av dem är *",
    cronCount: (n) => `vercel.json definierar ${n} cron-jobb, och Vercel tillåter högst 100 per projekt på alla planer`,
    cronCountFix: "Minska listan till högst 100 cron-jobb, till exempel genom att låta en route köra flera uppgifter som har samma schema.",
    maxDuration: (pattern, seconds) => `functions-posten ${pattern} sätter maxDuration till ${seconds} sekunder, över de 300 sekunder som Hobby-planen tillåter; Vercel godtar bara ett värde från 1 upp till planens maximum`,
    maxDurationFix: "På Hobby-planen, sänk maxDuration till 300 eller sätt den till max, som Vercel gör om till planens maximum vid deploy. Pro tillåter upp till 800 sekunder, och upp till 1800 sekunder i beta för vissa Node.js-, Bun- och Python-runtimes.",
    memory: (pattern) => `functions-posten ${pattern} sätter memory, som Vercel inte läser från vercel.json med Fluid compute, standard för nya projekt; bygget skriver bara en varning och funktionen behåller projektets minnesstorlek`,
    memoryFix: "Ta bort memory från vercel.json. På Pro och Enterprise ställer du in minnesstorleken i projektet under Settings, Functions. På Hobby får varje funktion alltid standardstorleken 2 GB.",
    webpack: (major) => `sätter en egen webpack-konfiguration, men Next.js ${major} kör next build med Turbopack som standard, och uppgraderingsguiden för Next.js 16 säger att bygget då misslyckas för att förhindra felkonfiguration`,
    webpackFix: "Välj ett av sätten som uppgraderingsguiden för Next.js 16 anger: behåll Webpack med next build --webpack i build-skriptet, bygg med Turbopack och bortse från webpack-konfigurationen med next build --turbopack, eller flytta inställningarna till turbopack-alternativet i next.config. Med --turbopack gäller inte längre det som webpack-funktionen ändrade, så testa appen efter bygget.",
    exportDynamic: (route) => `${route} är en dynamisk route utan generateStaticParams, och next.config sätter output till export, där varje dynamisk route måste renderas vid bygget; next build stoppar med ett fel om att sidan saknar generateStaticParams()`,
    webpackPlugin: (major) => `sätter en egen webpack-konfiguration utan turbopack-alternativ, vilket får Next.js ${major} att stoppa next build, men next.config skickar konfigurationen genom ett plugin, en funktion eller en spread som kan lägga till ett turbopack-alternativ när konfigurationen laddas, som @next/mdx och next-intl gör, och då går bygget igenom`,
    webpackPluginFix: "Kör next build på din dator. Stoppar det med This build is using Turbopack, with a webpack config and no turbopack config, använd ett av sätten som uppgraderingsguiden för Next.js 16 anger: next build --webpack i build-skriptet, next build --turbopack eller ett turbopack-alternativ i next.config. Går det igenom lägger pluginet till alternativet och inget behöver ändras.",
    exportDynamicFix: "Exportera generateStaticParams från sidan eller en överordnad layout och returnera ett params-objekt för varje sida som ska byggas, med ett värde för varje dynamiskt segment. Om sökvägarna inte går att veta vid bygget, ta bort output: export från next.config så att Vercel renderar routen vid varje anrop.",
    exportDynamicRouteFix: "Exportera generateStaticParams från den här route-filen och returnera ett params-objekt för varje sökväg som ska byggas, med ett värde för varje dynamiskt segment; en route handler tar det inte från en layout. Om sökvägarna inte går att veta vid bygget, ta bort output: export från next.config så att Vercel kör route handlern som en funktion.",
    exportRouteMethods: (methods) => `exporterar ${methods}, men med output satt till export i next.config stöder Next.js bara GET i route handlers, och den exporterade sajten är vanliga filer utan någon server som svarar på andra metoder`,
    exportRouteMethodsFix: "Ta bort output: export från next.config så att Vercel kör route handlern som en funktion, eller skicka anropen till ett API som körs någon annanstans.",
    exportRouteStatic: "har en GET-route handler som inte är markerad som statisk, så med output satt till export i next.config stoppar next build med ett fel om att export const dynamic = force-static eller export const revalidate inte är konfigurerat för routen",
    exportRouteStaticFix: 'Lägg till export const dynamic = "force-static" i filen om svaret kan byggas en gång vid bygget. Läser handlern anropet, till exempel headers, cookies eller sökparametrar, kan den inte ingå i en statisk export: ta bort output: export från next.config i stället.',
    exportProxy: "körs på inkommande anrop, men en statisk export (output satt till export i next.config) stöder inte Proxy eller middleware, eftersom de behöver det inkommande anropet, så filen körs inte på den exporterade sajten",
    exportProxyFix: "Flytta redirects, rewrites och headers till vercel.json och annan logik in i sidorna, eller ta bort output: export från next.config så att Vercel kör appen med en server.",
    exportAction: "definierar en Server Action med use server, och Server Actions stöds inte i en statisk export (output satt till export i next.config): den exporterade sajten har ingen server som kan köra dem",
    exportActionFix: "Anropa ett API från klienten i stället för Server Action, eller ta bort output: export från next.config så att Vercel kan köra Server Actions.",
    exportIsr: (seconds) => `sätter revalidate till ${seconds}, men Incremental Static Regeneration stöds inte i en statisk export (output satt till export i next.config), så sidan byggs bara en gång`,
    exportIsrFix: "Ta bort revalidate och driftsätt igen när innehållet ändras, eller ta bort output: export från next.config för att använda ISR på Vercel.",
    exportApiRoute: "är en API-route i Pages Router, och API-routes kan inte användas med en statisk export (output satt till export i next.config)",
    exportApiRouteFix: "Ta bort output: export från next.config så att Vercel kör API-routen som en funktion, eller flytta endpointen till ett API som körs någon annanstans.",
    exportGssp: "använder getServerSideProps, som inte stöds i en statisk export (output satt till export i next.config)",
    exportGsspFix: "Använd getStaticProps eller hämta datan i klienten, eller ta bort output: export från next.config så att Vercel renderar sidan vid varje anrop.",
    remoteImage: (src, host) => `next/image laddar ${src}, men ${host} finns inte i images.remotePatterns eller images.domains i next.config; bildoptimeringen i Next.js svarar 400 Bad Request för en värd som inte matchar, så bilden visas inte, och next dev kastar Invalid src prop med hostname ${host} is not configured under images`,
    remoteImageFix: (host) => `Tillåt värden i next.config med images: { remotePatterns: [new URL("https://${host}/**")] }, begränsad till sökvägen du använder om det går, och driftsätt igen. Behöver bilden inte optimeras kan du i stället lägga till propen unoptimized på den här Image.`,
    svelteAdapter: (adapter, target) => `konfigurerar ${adapter}, som bygger appen för ${target}, inte för Vercel; SvelteKit-dokumentationen säger att man ska använda adapter-vercel för att driftsätta på Vercel`,
    svelteAdapterFix: (file) => `Installera @sveltejs/adapter-vercel som dev-beroende, importera adaptern från det i ${file} i stället och driftsätt igen. @sveltejs/adapter-auto fungerar också på Vercel: den känner av Vercel och installerar adapter-vercel vid bygget, men Vercel rekommenderar att du installerar adapter-vercel själv för stabila versioner.`,
    svelteTargets: { node: "en fristående Node-server som startas med node build", netlify: "Netlify", cloudflare: "Cloudflare", "cloudflare-workers": "Cloudflare Workers", bun: "en Bun-server" },
    astroOutputNoAdapter: (output) => `sätter output till ${output}, som renderar sidor vid varje anrop, men saknar adapter, så astro build stoppar med NoAdapterInstalled: Cannot use server-rendered pages without an adapter`,
    astroPrerenderNoAdapter: "sätter prerender till false, som renderar routen vid varje anrop, men projektet saknar Astro-adapter, så astro build stoppar med NoAdapterInstalled: Cannot use server-rendered pages without an adapter",
    astroNoAdapterFix: "Kör npx astro add vercel, som installerar @astrojs/vercel och lägger till adapter: vercel() i astro.config, och driftsätt igen. En helt statisk Astro-sajt behöver ingen adapter på Vercel, så det fungerar också att ta bort renderingen vid anrop.",
    astroOtherAdapter: (adapter) => `renderar sidor vid varje anrop med ${adapter}, men Vercels dokumentation för Astro säger att en serverrenderad Astro-app måste använda Astros Vercel-adapter, @astrojs/vercel`,
    astroOtherAdapterFix: (adapter) => `Kör npx astro add vercel, ta bort ${adapter} från astro.config och package.json, och driftsätt igen.`,
    red: (n) => `${n} projektinställning${n === 1 ? "" : "ar"} stoppar Vercel-bygget.`,
    yellow: (n) => `${n} projektinställning${n === 1 ? "" : "ar"} kan göra att Vercel-bygget beter sig annorlunda än på din dator.`,
    ok: "En lockfil, ett build-skript och en Node-version som Vercel stöder.",
    okAdapter: (framework) => `En lockfil, ett build-skript, en Node-version som Vercel stöder och inga problem med ${framework}-adaptern.`,
  },
  prisma: {
    okDrizzle: "Drizzle hittades. SQLite-drivrutiner fångas av kontrollen för Vercel-inkompatibel serverkod.",
    okNone: "Varken Prisma eller Drizzle hittades i package.json, så det finns inget att kontrollera.",
    noGenerate: "kör inte prisma generate vid installation eller bygge",
    noGenerateFix: 'Lägg till "postinstall": "prisma generate" under scripts i package.json; Vercel cachar node_modules och Prisma Client blir annars föråldrad.',
    sqlite: "använder SQLite, som inte fungerar på Vercel Functions",
    sqliteFix: "Byt provider till en hostad databas (t.ex. postgresql) och sätt DATABASE_URL i Vercel.",
    red: (n) => `${n} Prisma-problem kan stoppa bygget eller databasen på Vercel.`,
    partial: "Inga Prisma-problem hittades i det vi läste, men skanningen blev inte klar.",
    ok: "prisma generate körs vid bygge och ingen SQLite-databas hittades.",
  },
};

export function analysisText(lang: Lang): AnalysisText {
  return lang === "sv" ? sv : en;
}
