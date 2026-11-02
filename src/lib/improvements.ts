import type { RepositorySnapshot } from "@/lib/analyzer";
import type { Stack } from "@/lib/stack";
import type { Lang } from "@/lib/i18n";

/**
 * Improvements are not errors: they are things a scan can see are missing and that make an app better on Vercel.
 * They come from the same snapshot as the checks (the file tree and the files already read), cost no AI call,
 * and are only suggested when the evidence was actually read. Absence in a truncated tree is not evidence.
 */
export type ImprovementId = "error-boundary" | "not-found-page" | "share-image" | "sitemap" | "security-headers" | "node-version" | "lockfile" | "ci-check" | "readme-badge";
export type Improvement = { id: ImprovementId; file: string };

const CODE = "(?:tsx|ts|jsx|js|mjs)";
const has = (files: Set<string>, pattern: RegExp) => [...files].some(file => pattern.test(file));
const esc = (dir: string) => dir.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

export function findImprovements(snapshot: RepositorySnapshot, stack: Stack, nextApp: "root" | "nested" | "none"): Improvement[] {
  // Private repositories get the same suggestions except the public README badge (reportJson and the page drop it).
  // Without the full tree, "missing" only means "not seen".
  if (snapshot.partialReasons?.includes("truncated_tree")) return [];
  const files = new Set(snapshot.entries.filter(entry => entry.type === "blob").map(entry => entry.path));
  const read = (file: string) => snapshot.contents.get(file);
  const out: Improvement[] = [];

  if (stack.hasNext && nextApp === "root") {
    const appDir = ["app", "src/app"].find(dir => has(files, new RegExp(`^${esc(dir)}/(?:.*/)?(?:page|layout)\\.${CODE}$`)));
    const pagesDir = ["pages", "src/pages"].find(dir => has(files, new RegExp(`^${esc(dir)}/.*\\.${CODE}$`)));
    if (appDir) {
      if (!has(files, new RegExp(`^${esc(appDir)}/(?:global-)?error\\.${CODE}$`))) out.push({ id: "error-boundary", file: `${appDir}/error.tsx` });
      if (!has(files, new RegExp(`^${esc(appDir)}/not-found\\.${CODE}$`))) out.push({ id: "not-found-page", file: `${appDir}/not-found.tsx` });
      const layoutFile = [...files].find(file => new RegExp(`^${esc(appDir)}/layout\\.${CODE}$`).test(file));
      const layout = layoutFile ? read(layoutFile) : undefined;
      const image = has(files, new RegExp(`^${esc(appDir)}/(?:opengraph|twitter)-image\\.(?:tsx|ts|js|png|jpe?g|gif)$`));
      // A layout that sets openGraph or twitter metadata may point at an image elsewhere; only an unread layout is unknown.
      if (!image && layout !== undefined && !/\b(?:openGraph|twitter)\s*:/.test(layout)) out.push({ id: "share-image", file: `${appDir}/opengraph-image.tsx` });
      if (!has(files, new RegExp(`^${esc(appDir)}/sitemap\\.(?:xml|ts|js)$`)) && !files.has("public/sitemap.xml")) out.push({ id: "sitemap", file: `${appDir}/sitemap.ts` });
    } else if (pagesDir) {
      if (!has(files, new RegExp(`^${esc(pagesDir)}/(?:_error|500)\\.${CODE}$`))) out.push({ id: "error-boundary", file: `${pagesDir}/500.tsx` });
      if (!has(files, new RegExp(`^${esc(pagesDir)}/404\\.${CODE}$`))) out.push({ id: "not-found-page", file: `${pagesDir}/404.tsx` });
    }
    // Security headers can live in next.config, vercel.json, or middleware/proxy. All of them must have been read.
    const configs = [...files].filter(file => /^next\.config\.(?:js|mjs|cjs|ts|mts)$/.test(file) || file === "vercel.json" || new RegExp(`^(?:src/)?(?:middleware|proxy)\\.${CODE}$`).test(file));
    const texts = configs.map(read);
    if (texts.every(text => text !== undefined) && !texts.some(text => /\bheaders\b|Strict-Transport-Security|Content-Security-Policy|X-Frame-Options/i.test(text!))) {
      out.push({ id: "security-headers", file: configs.find(file => file.startsWith("next.config")) ?? "next.config.ts" });
    }
  }

  const manifest = read("package.json");
  if (manifest !== undefined) {
    let pkg: { engines?: { node?: string }; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
    try { pkg = JSON.parse(manifest); } catch { pkg = {}; }
    if (!pkg.engines?.node && !files.has(".nvmrc") && !files.has(".node-version") && !files.has(".tool-versions")) out.push({ id: "node-version", file: "package.json" });
    const dependencies = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length;
    if (dependencies > 0 && !["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "npm-shrinkwrap.json"].some(lock => files.has(lock))) out.push({ id: "lockfile", file: "package-lock.json" });
  }

  // Workflow files are listed in the tree but not read: a workflow named after DeployDoctor counts as present.
  if (stack.hasPackageJson && !has(files, /^\.github\/workflows\/[^/]*deploy-?doctor[^/]*\.ya?ml$/i)) out.push({ id: "ci-check", file: ".github/workflows/deploydoctor.yml" });
  if (has(files, /^readme(?:\.md)?$/i)) out.push({ id: "readme-badge", file: [...files].find(file => /^readme(?:\.md)?$/i.test(file))! });
  // Most visible first: the report shows four before "show more".
  return out.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
}

const ORDER: ImprovementId[] = ["error-boundary", "share-image", "ci-check", "not-found-page", "security-headers", "sitemap", "node-version", "lockfile", "readme-badge"];

type Copy = { title: string; why: string; how: string; docs?: string };
const DOCS = {
  error: "https://nextjs.org/docs/app/api-reference/file-conventions/error",
  notFound: "https://nextjs.org/docs/app/api-reference/file-conventions/not-found",
  pagesError: "https://nextjs.org/docs/pages/building-your-application/routing/custom-error",
  image: "https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image",
  sitemap: "https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap",
  headers: "https://nextjs.org/docs/app/api-reference/config/next-config-js/headers",
  node: "https://vercel.com/docs/functions/runtimes/node-js/node-js-versions",
  lock: "https://vercel.com/docs/package-managers",
};

/** Title, reason, how-to and documentation for one improvement, in the visitor's language. */
export function improvementCopy(item: Improvement, lang: Lang): Copy {
  const sv = lang === "sv";
  const pages = item.file.includes("pages/");
  switch (item.id) {
    case "error-boundary": return sv
      ? { title: "Lägg till en felsida", why: "Ett fel under körning visar annars Next.js standardskärm för krascher för dina besökare.", how: `Skapa ${item.file} med en kort förklaring och en knapp för att försöka igen.`, docs: pages ? DOCS.pagesError : DOCS.error }
      : { title: "Add an error page", why: "Without one, a runtime error shows visitors the default Next.js crash screen.", how: `Create ${item.file} with a short message and a retry button.`, docs: pages ? DOCS.pagesError : DOCS.error };
    case "not-found-page": return sv
      ? { title: "Lägg till en egen 404-sida", why: "En egen 404-sida behåller navigationen och länkar besökaren vidare i stället för en tom standardsida.", how: `Skapa ${item.file} med en länk tillbaka till startsidan.`, docs: pages ? DOCS.pagesError : DOCS.notFound }
      : { title: "Add a custom 404 page", why: "A custom 404 keeps your navigation and sends visitors on instead of a blank default page.", how: `Create ${item.file} with a link back home.`, docs: pages ? DOCS.pagesError : DOCS.notFound };
    case "share-image": return sv
      ? { title: "Ge länkarna en delningsbild", why: "Utan bild delas dina länkar på X, LinkedIn och Slack som ren text och får färre klick.", how: `Lägg en 1200×630-bild som ${item.file.replace(/\.tsx$/, ".png")}, eller generera den i ${item.file}.`, docs: DOCS.image }
      : { title: "Give your links a share image", why: "Without one, links to your app unfurl as plain text on X, LinkedIn and Slack and get fewer clicks.", how: `Drop a 1200×630 image at ${item.file.replace(/\.tsx$/, ".png")}, or generate one in ${item.file}.`, docs: DOCS.image };
    case "sitemap": return sv
      ? { title: "Lägg till en sitemap", why: "En sitemap hjälper Google att hitta och indexera alla dina sidor snabbare.", how: `Skapa ${item.file} som listar dina publika sidor.`, docs: DOCS.sitemap }
      : { title: "Add a sitemap", why: "A sitemap helps Google find and index every page sooner.", how: `Create ${item.file} that lists your public pages.`, docs: DOCS.sitemap };
    case "security-headers": return sv
      ? { title: "Skicka säkerhetsheaders", why: "Inga headers som X-Frame-Options, HSTS eller Content-Security-Policy syns i next.config, vercel.json eller proxy/middleware.", how: `Lägg till async headers() i ${item.file} och börja med X-Frame-Options, Referrer-Policy och Strict-Transport-Security.`, docs: DOCS.headers }
      : { title: "Send security headers", why: "No headers such as X-Frame-Options, HSTS or a Content-Security-Policy are set in next.config, vercel.json or proxy/middleware.", how: `Add async headers() to ${item.file}, starting with X-Frame-Options, Referrer-Policy and Strict-Transport-Security.`, docs: DOCS.headers };
    case "node-version": return sv
      ? { title: "Lås Node-versionen", why: "Utan engines.node bygger Vercel med projektets standardversion, som kan skilja sig från din dator.", how: `Lägg till "engines": { "node": "22.x" } i ${item.file}, med den version du kör lokalt.`, docs: DOCS.node }
      : { title: "Pin your Node version", why: "Without engines.node, Vercel builds with the project's default version, which can differ from your machine.", how: `Add "engines": { "node": "22.x" } to ${item.file}, matching the version you run locally.`, docs: DOCS.node };
    case "lockfile": return sv
      ? { title: "Checka in en lockfil", why: "Utan lockfil kan Vercel installera andra versioner av dina paket än de du testade med.", how: "Kör npm install (eller pnpm/yarn) och checka in lockfilen som skapas.", docs: DOCS.lock }
      : { title: "Commit a lockfile", why: "Without one, Vercel can install different package versions than the ones you tested.", how: "Run npm install (or pnpm/yarn) and commit the lockfile it creates.", docs: DOCS.lock };
    case "ci-check": return sv
      ? { title: "Fånga det här på varje pull request", why: "Samma kontroller kan stoppa en PR innan Vercel bygger den, gratis på publika repon.", how: `Lägg till ${item.file} med DeployDoctor-Actionen, tre rader YAML.`, docs: "/ci" }
      : { title: "Catch this on every pull request", why: "The same checks can fail a pull request before Vercel builds it, free on public repositories.", how: `Add ${item.file} with the DeployDoctor Action, three lines of YAML.`, docs: "/ci" };
    case "readme-badge": return sv
      ? { title: "Visa statusen i din README", why: "En badge visar besökare och bidragsgivare att din deploy är kontrollerad och länkar till senaste rapporten.", how: `Kopiera badgen längre ner till ${item.file}.`, docs: "#badge-heading" }
      : { title: "Show the status in your README", why: "A badge tells visitors and contributors your deploy is checked, and links to the latest report.", how: `Copy the badge further down into ${item.file}.`, docs: "#badge-heading" };
  }
}

/** The pre-filled X post for a public report: what the scan found, then where anyone can check their own repo. */
export function shareText(repo: string, summary: { red: number; yellow: number }, improvements: number, lang: Lang): string {
  const sv = lang === "sv";
  const more = improvements ? (sv ? ` och ${improvements} förbättring${improvements === 1 ? "" : "ar"}` : `, plus ${improvements} improvement${improvements === 1 ? "" : "s"} to make`) : "";
  if (!summary.red && !summary.yellow) return sv ? `${repo} klarade DeployDoctors Vercel-kontroll ✅${more}. Kolla ditt eget repo innan Vercel gör det:` : `${repo} passed DeployDoctor's Vercel preflight ✅${more}. Check your repo before Vercel does:`;
  const found = sv ? `${summary.red} att fixa, ${summary.yellow} att granska` : `${summary.red} to fix, ${summary.yellow} to review`;
  return sv ? `DeployDoctor skannade ${repo}: ${found}${more}. Hitta felen innan Vercel gör det:` : `DeployDoctor scanned ${repo}: ${found}${more}. Find what breaks before Vercel does:`;
}
