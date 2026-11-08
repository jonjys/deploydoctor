import { createHmac } from "node:crypto";
import { assertPublicHost, fetchPublic, inspectSite, LEAK_COPY, LeakCheckError, type Fetcher, type Resolver } from "@/lib/bundle-leaks";
import type { ExposedTable, SafetyFinding, SafetyReport } from "@/lib/app-safety-copy";
import { signingSecret } from "@/lib/session-token";

export type { SafetyReport } from "@/lib/app-safety-copy";

/**
 * "Is my app safe?": one verdict for a live site.
 *
 * Anyone may run the public checks: secret keys in the JavaScript every visitor downloads, browser protection headers,
 * and public source maps. The database check (which tables the public Supabase key can read) and the source file
 * check (.env, .git) only run after the owner proves control of the site with a file or a meta tag. They send reads
 * only: HEAD requests that return a row count, never a row.
 */

export type SafetyDeps = { fetcher?: Fetcher; resolve?: Resolver; secret?: string };

const SUPABASE_URL = /https:\/\/([a-z0-9]{20})\.supabase\.co\b/;
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{20,}/g;
const PUBLISHABLE = /\bsb_publishable_[0-9A-Za-z_-]{20,}/;
const FROM_TABLE = /\.from\(\s*["'`]([A-Za-z_][A-Za-z0-9_]{0,62})["'`]\s*\)/g;
const MAX_TABLES = 25;
const PROBE_TIMEOUT = 6000;

/** The value the owner publishes. Derived from the host, so it needs no storage and cannot be guessed for another site. */
export function ownerToken(host: string, secret: string): string {
  return `dd-verify-${createHmac("sha256", secret).update(`site-owner:${host.toLowerCase()}`).digest("hex").slice(0, 32)}`;
}

/** The Supabase project and its public key from the site's own JavaScript. The key is public by design; it is used, never returned. */
export function supabaseFromTexts(texts: Array<{ body: string }>): { host: string; key: string; tables: string[] } | null {
  let ref: string | null = null, key: string | null = null;
  const tables = new Set<string>();
  for (const { body } of texts) {
    ref ??= SUPABASE_URL.exec(body)?.[1] ?? null;
    if (!key) {
      for (const match of body.matchAll(JWT)) {
        try {
          const claims = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")) as { role?: string; ref?: string };
          if (claims.role === "anon") { key = match[0]; ref ??= claims.ref ?? null; break; }
        } catch { /* not a JWT */ }
      }
      key ??= PUBLISHABLE.exec(body)?.[0] ?? null;
    }
    for (const match of body.matchAll(FROM_TABLE)) if (tables.size < MAX_TABLES * 2) tables.add(match[1]);
  }
  return ref && key ? { host: `${ref}.supabase.co`, key, tables: [...tables] } : null;
}

/** Content-Range "0-0/2341" or "*\/0" to a row count. */
export function rowCount(contentRange: string | null): number | null {
  const total = /\/(\d+)$/.exec(contentRange ?? "")?.[1];
  return total === undefined ? null : Number(total);
}

async function timed(fetcher: Fetcher, url: string, init: RequestInit): Promise<Response | null> {
  try { return await fetcher(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT) }); } catch { return null; }
}

/** Tables the public key can read, by name and row count. HEAD only, so no row ever leaves the database. */
export async function probeSupabase(project: { host: string; key: string; tables: string[] }, fetcher: Fetcher, resolve: Resolver): Promise<{ exposed: ExposedTable[]; checked: number; partial: boolean }> {
  if (!/^[a-z0-9]{20}\.supabase\.co$/.test(project.host)) return { exposed: [], checked: 0, partial: true };
  await resolve(project.host);
  const headers: Record<string, string> = { apikey: project.key, accept: "application/openapi+json, application/json" };
  if (project.key.startsWith("eyJ")) headers.authorization = `Bearer ${project.key}`;
  const names = new Set(project.tables);
  // The schema the key can see, when the project still serves it to the public key.
  const root = await timed(fetcher, `https://${project.host}/rest/v1/`, { headers });
  if (root?.ok) {
    try {
      const text = (await root.text()).slice(0, 2_000_000);
      for (const path of Object.keys((JSON.parse(text) as { paths?: Record<string, unknown> }).paths ?? {})) {
        const name = /^\/([A-Za-z_][A-Za-z0-9_]{0,62})$/.exec(path)?.[1];
        if (name) names.add(name);
      }
    } catch { /* not the schema */ }
  } else await root?.body?.cancel().catch(() => undefined);
  const list = [...names].slice(0, MAX_TABLES);
  const exposed: ExposedTable[] = [];
  let partial = names.size > MAX_TABLES;
  await Promise.all(list.map(async table => {
    const response = await timed(fetcher, `https://${project.host}/rest/v1/${encodeURIComponent(table)}?select=*`, { method: "HEAD", headers: { ...headers, prefer: "count=exact", range: "0-0", "range-unit": "items" } });
    if (!response) { partial = true; return; }
    if (response.status === 200 || response.status === 206) {
      const rows = rowCount(response.headers.get("content-range"));
      if (rows && rows > 0) exposed.push({ table, rows });
    }
  }));
  return { exposed: exposed.sort((a, b) => b.rows - a.rows), checked: list.length, partial };
}

const ENV_FILE = /^\s*[A-Z][A-Z0-9_]{2,}\s*=\s*\S/m;
const SENSITIVE_PATHS = ["/.env", "/.env.local", "/.env.production", "/.git/config", "/.git/HEAD"];

/** Source files served to the public. Only whether each path answers with that kind of file is kept, never its content. */
export async function probeFiles(origin: URL, fetcher: Fetcher, resolve: Resolver): Promise<string[]> {
  const found: string[] = [];
  await Promise.all(SENSITIVE_PATHS.map(async path => {
    const page = await fetchPublic(new URL(path, origin), 20_000, fetcher, async host => { if (host !== origin.hostname) throw new LeakCheckError("off-site"); await resolve(host); }).catch(() => null);
    if (!page || /<html|<!doctype/i.test(page.body.slice(0, 500))) return;
    const lines = page.body.split("\n").filter(line => ENV_FILE.test(line)).length;
    if ((path.startsWith("/.env") && lines >= 2) || (path === "/.git/config" && /^\[core\]/m.test(page.body)) || (path === "/.git/HEAD" && /^ref: refs\//.test(page.body))) found.push(path);
  }));
  return found.sort();
}

export function headerFindings(headers: Headers): SafetyFinding[] {
  const csp = headers.get("content-security-policy") ?? "";
  const findings: SafetyFinding[] = [];
  findings.push(headers.get("strict-transport-security")
    ? { id: "hsts", area: "headers", status: "pass", title: "HTTPS is enforced (HSTS)", detail: "Browsers will refuse a plain http connection to this site." }
    : { id: "hsts", area: "headers", status: "warn", title: "HTTPS is not enforced (no HSTS header)", detail: "A browser on a hostile network can be sent to the http version first.", fix: "Add Strict-Transport-Security: max-age=63072000; includeSubDomains. Vercel adds it on its own domains." });
  findings.push(/frame-ancestors/i.test(csp) || /^(deny|sameorigin)$/i.test(headers.get("x-frame-options") ?? "")
    ? { id: "framing", area: "headers", status: "pass", title: "Other sites cannot frame your pages", detail: "Protects sign-in and payment buttons from clickjacking." }
    : { id: "framing", area: "headers", status: "warn", title: "Other sites can put your pages in a frame", detail: "A hostile page can overlay your buttons and trick a signed-in user into clicking them (clickjacking).", fix: "Send X-Frame-Options: DENY, or Content-Security-Policy: frame-ancestors 'none'." });
  findings.push(csp
    ? { id: "csp", area: "headers", status: "pass", title: "Content Security Policy is set", detail: "Limits which scripts the browser will run." }
    : { id: "csp", area: "headers", status: "warn", title: "No Content Security Policy", detail: "If someone gets a script into a page (a comment, a profile name), the browser runs it with full access.", fix: "Start with Content-Security-Policy: default-src 'self' and add the hosts your app really uses." });
  findings.push(/nosniff/i.test(headers.get("x-content-type-options") ?? "")
    ? { id: "nosniff", area: "headers", status: "pass", title: "Browsers do not guess file types", detail: "X-Content-Type-Options: nosniff is set." }
    : { id: "nosniff", area: "headers", status: "info", title: "X-Content-Type-Options is missing", detail: "Minor: browsers may guess a file's type.", fix: "Send X-Content-Type-Options: nosniff." });
  return findings;
}

export async function checkAppSafety(input: string, deps: SafetyDeps = {}): Promise<SafetyReport> {
  const fetcher = deps.fetcher ?? fetch, resolve = deps.resolve ?? assertPublicHost;
  const secret = deps.secret ?? signingSecret();
  const { report: leaks, page, texts } = await inspectSite(input, { fetcher, resolve });
  const origin = new URL(`https://${page.url.hostname}/`);
  const token = ownerToken(origin.hostname, secret);
  const findings: SafetyFinding[] = [];
  let partial = leaks.partial;

  // Ownership: a file at /.well-known/deploydoctor.txt or a meta tag on the homepage holding the token.
  const metaVerified = new RegExp(`<meta[^>]+name=["']deploydoctor-verify["'][^>]+content=["']${token}["']|<meta[^>]+content=["']${token}["'][^>]+name=["']deploydoctor-verify["']`, "i").test(page.body);
  const fileVerified = metaVerified ? false : Boolean((await fetchPublic(new URL("/.well-known/deploydoctor.txt", origin), 2000, fetcher, resolve).catch(() => null))?.body.includes(token));
  const verified = metaVerified || fileVerified;

  // Keys.
  const critical = leaks.leaks.filter(leak => leak.severity === "critical");
  for (const leak of leaks.leaks) findings.push({ id: `leak-${leak.kind}-${leak.masked}`, area: "keys", status: leak.severity === "critical" ? "fail" : "warn",
    title: `${LEAK_COPY[leak.kind].name} is public (${leak.masked})`, detail: `Found in ${leak.file}, a file every visitor downloads.`, fix: LEAK_COPY[leak.kind].fix });
  if (!critical.length) findings.push({ id: "keys-clean", area: "keys", status: "pass", title: "No secret keys in your live JavaScript", detail: `${leaks.files} files read${leaks.partial ? ", some could not be read" : ""}.` });

  // Database.
  const project = supabaseFromTexts(texts);
  let exposedTables: ExposedTable[] = [];
  if (!project) findings.push({ id: "db-none", area: "database", status: "info", title: "No Supabase project found in the site", detail: "The database check covers Supabase, the backend most AI app builders use." });
  else if (!verified) findings.push({ id: "db-unverified", area: "database", status: "info", title: `Supabase project ${project.host} found, not tested`, detail: "Prove you own this site to check which tables strangers can read with your public key." });
  else {
    const probe = await probeSupabase(project, fetcher, resolve).catch(() => ({ exposed: [], checked: 0, partial: true }));
    exposedTables = probe.exposed;
    partial ||= probe.partial;
    for (const table of probe.exposed) findings.push({ id: `db-${table.table}`, area: "database", status: "fail", title: `Anyone can read ${table.table}: ${table.rows.toLocaleString("en-US")} rows`,
      detail: "No sign-in needed: the public key in your JavaScript is enough. DeployDoctor counted the rows and read none of them.",
      fix: `In Supabase, Table Editor, ${table.table}: enable Row Level Security, then add a policy such as "users can read their own rows" (auth.uid() = user_id).` });
    if (!probe.exposed.length) findings.push({ id: "db-clean", area: "database", status: probe.checked ? "pass" : "info", title: probe.checked ? `None of ${probe.checked} tables can be read without signing in` : "No tables could be checked",
      detail: probe.checked ? "The public key returned no rows from any table it was tried on." : "The project did not list its tables and none were named in the site's code." });
  }

  // Source files.
  const maps = [...new Set(texts.flatMap(({ body }) => [...body.matchAll(/\/\/[#@] sourceMappingURL=([^\s'"]+\.map)\b/g)].map(match => match[1])))].slice(0, 1);
  let mapPublic = false;
  if (maps.length) {
    const base = texts.find(({ body }) => body.includes(maps[0]))?.file ?? "/";
    const mapUrl = new URL(maps[0], new URL(base, origin));
    if (mapUrl.hostname === origin.hostname) mapPublic = Boolean((await fetchPublic(mapUrl, 400, fetcher, resolve).catch(() => null))?.body.trimStart().startsWith("{"));
  }
  findings.push(mapPublic
    ? { id: "sourcemaps", area: "files", status: "warn", title: "Source maps are public", detail: "Anyone can rebuild your original front-end source code, comments included.", fix: "Turn off production browser source maps (Next.js: productionBrowserSourceMaps: false; Vite: build.sourcemap: false) or upload them to your error tracker only." }
    : { id: "sourcemaps", area: "files", status: "pass", title: "No public source maps found", detail: "The shipped JavaScript does not point to readable source." });
  if (verified) {
    const files = await probeFiles(origin, fetcher, resolve);
    for (const file of files) findings.push({ id: `file-${file}`, area: "files", status: "fail", title: `${file} is publicly downloadable`, detail: file.startsWith("/.env") ? "It holds your environment variables, secrets included." : "Your git repository can be downloaded, with its full history.", fix: "Remove it from the deployed folder, rotate every secret it held, and redeploy." });
    if (!files.length) findings.push({ id: "files-clean", area: "files", status: "pass", title: "No .env or .git files are served", detail: `Checked ${SENSITIVE_PATHS.join(", ")}.` });
  }

  findings.push(...headerFindings(page.headers));

  const order = { fail: 0, warn: 1, info: 2, pass: 3 } as const;
  findings.sort((a, b) => order[a.status] - order[b.status]);
  const summary = { fail: findings.filter(f => f.status === "fail").length, warn: findings.filter(f => f.status === "warn").length, pass: findings.filter(f => f.status === "pass").length };
  return {
    url: leaks.url, host: origin.hostname,
    verdict: summary.fail ? "not-safe" : verified ? "no-issues" : "public-checks-passed",
    owner: { verified, token, file: "/.well-known/deploydoctor.txt", meta: `<meta name="deploydoctor-verify" content="${token}">` },
    supabase: project?.host ?? null, exposedTables, findings, summary, partial,
  };
}
