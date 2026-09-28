import type { Lang } from "@/lib/i18n";

export type AnalysisText = {
  titles: { nextEntry: string; imports: string; serverLibs: string; env: string; supabase: string; prisma: string };
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
  server: { red: string; fix: string; write: (file: string) => string; partial: string; ok: string };
  env: {
    missing: (n: number, names: string) => string; exposed: (n: number, names: string) => string;
    fixMissing: (names: string) => string; fixExposed: string;
    missingProblem: (name: string) => string; missingFix: (name: string) => string;
    exposedProblem: (name: string) => string; exposedFix: (name: string) => string;
    evidenceMissing: (name: string) => string; evidenceExposed: (name: string) => string;
    gitignore: (rule: string) => string; gitignoreProblem: (rule: string) => string;
    gitignoreFix: (line: string) => string; evidenceGitignore: (rule: string) => string;
    partial: string; okUsed: string; okNone: string;
  };
  supabase: {
    serverBrowser: (file: string) => string; clientKey: (file: string) => string;
    red: string; fix: string; partial: string; ok: string;
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
    ok: "No Playwright, Puppeteer, SQLite binding, or filesystem write in an API route was found.",
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
    ok: "Ingen Playwright, Puppeteer, SQLite-koppling eller filsystemsskrivning i en API-route hittades.",
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
