import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { findSecrets } from "@/lib/secrets";

/**
 * Live leak check: reads the HTML and same-origin JavaScript that any visitor's browser downloads from a public
 * https site, and reports secret-shaped values by type and file. Values never leave this module unmasked, nothing is
 * stored, and only the site's own host is fetched. Secrets set as NEXT_PUBLIC_ or VITE_ variables are written into
 * the built JavaScript at build time, so they never appear in the repository where GitHub secret scanning looks.
 */

import type { Leak, LeakKind, LeakReport, PublicKey } from "@/lib/bundle-leaks-copy";
export { LEAK_COPY } from "@/lib/bundle-leaks-copy";
export type { Leak, LeakKind, LeakReport, PublicKey };

export class LeakCheckError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const LIMITS = { hops: 3, timeoutMs: 8000, htmlBytes: 2_000_000, scriptBytes: 3_000_000, totalBytes: 12_000_000, scripts: 30 };

/** Private, loopback, link-local, CGNAT, multicast and reserved ranges: never fetched. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)));
  }
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    if (lower.startsWith("::ffff:")) return isPublicAddress(lower.slice(7));
    return !(lower === "::" || lower === "::1" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith("ff") || lower.startsWith("64:ff9b"));
  }
  return false;
}

/** A public https URL on a named host. IP literals, localhost and non-default ports are refused. */
export function normalizeSiteUrl(input: string): URL {
  const trimmed = input.trim();
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`); } catch { throw new LeakCheckError("Enter your live site address, for example my-app.vercel.app."); }
  if (url.protocol !== "https:") throw new LeakCheckError("Only https sites can be checked.");
  if (url.username || url.password || url.port) throw new LeakCheckError("Enter the site address without a port or login.");
  const host = url.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".") || /(?:^|\.)(?:localhost|local|internal|lan|home|corp)$/.test(host)) throw new LeakCheckError("Enter a public site address, not an IP or a local name.");
  url.hash = "";
  return url;
}

async function assertPublicHost(host: string) {
  let addresses: Array<{ address: string }>;
  try { addresses = await lookup(host, { all: true, verbatim: true }); } catch { throw new LeakCheckError("That site address does not resolve.", 422); }
  if (!addresses.length || !addresses.every(entry => isPublicAddress(entry.address))) throw new LeakCheckError("That address is not a public website.", 422);
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type Resolver = (host: string) => Promise<void>;

async function readBounded(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel().catch(() => undefined); break; }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** GET with manual redirects, each hop on https and re-checked, staying on the first host's site. */
async function fetchPublic(start: URL, limit: number, fetcher: Fetcher, resolve: Resolver): Promise<{ url: URL; body: string; type: string } | null> {
  let url = start;
  for (let hop = 0; hop <= LIMITS.hops; hop++) {
    await resolve(url.hostname);
    const response = await fetcher(url.toString(), { redirect: "manual", signal: AbortSignal.timeout(LIMITS.timeoutMs), headers: { "user-agent": "DeployDoctor-LeakCheck/1.0 (+https://deploydoctor.nyttolabs.com/leak-check)", accept: "text/html,application/javascript,*/*;q=0.5" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) return null;
      const next = new URL(location, url);
      if (next.protocol !== "https:" || next.port || next.username) throw new LeakCheckError("The site redirects to an address that cannot be checked.", 422);
      url = next;
      continue;
    }
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); return null; }
    return { url, body: await readBounded(response, limit), type: response.headers.get("content-type") ?? "" };
  }
  throw new LeakCheckError("The site redirects too many times.", 422);
}

/** Same-origin script URLs from the HTML: script tags, preloads, and Next.js and Vite chunk paths in inline data. */
export function scriptUrls(html: string, base: URL): string[] {
  const found = new Set<string>();
  const add = (raw: string) => {
    try {
      const url = new URL(raw.replace(/\\u002F/g, "/").replace(/&amp;/g, "&"), base);
      if (url.protocol === "https:" && url.hostname === base.hostname && /\.m?js(?:$|\?)/.test(url.pathname + (url.search ? "?" : ""))) { url.hash = ""; found.add(url.toString()); }
    } catch { /* not a URL */ }
  };
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) add(match[1]);
  for (const match of html.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.m?js[^"']*)["']/gi)) add(match[1]);
  for (const match of html.matchAll(/["'(]((?:https?:\/\/[^"'\s()]+)?\/(?:_next\/static|assets|static\/js|_app\/immutable|build)\/[^"'\s()]+?\.m?js)(?=["')?\\])/g)) add(match[1]);
  return [...found].slice(0, LIMITS.scripts);
}

const EXTRA: Array<{ kind: LeakKind; regex: RegExp }> = [
  { kind: "openai-key", regex: /\b(sk-(?:proj|svcacct|admin)-)([A-Za-z0-9_-]{40,})/g },
  { kind: "openai-key", regex: /\b(sk-)([A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20})\b/g },
  { kind: "anthropic-key", regex: /\b(sk-ant-(?:api|admin)\d{2}-)([A-Za-z0-9_-]{80,})/g },
  { kind: "stripe-test-secret", regex: /\b(sk_test_)([0-9A-Za-z]{24,})\b/g },
];
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{20,}/g;

function jwtRole(payload: string): string | null {
  try { const role = (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { role?: unknown }).role; return typeof role === "string" ? role : null; } catch { return null; }
}

/** Secrets and public keys in one downloaded file. Only masked values are returned. */
export function scanText(text: string, file: string): { leaks: Leak[]; publicKeys: PublicKey[] } {
  const leaks: Leak[] = findSecrets(text).map(match => ({ kind: match.kind, severity: "critical" as const, file, masked: match.masked }));
  for (const { kind, regex } of EXTRA) for (const match of text.matchAll(regex)) {
    const [, prefix, body] = match;
    if (new Set(body).size < 10 || /x{6,}|your|example|placeholder/i.test(body)) continue;
    leaks.push({ kind, severity: kind === "stripe-test-secret" ? "warning" : "critical", file, masked: `${prefix}…${body.slice(-4)}` });
  }
  const publicKeys: PublicKey[] = [];
  for (const match of text.matchAll(JWT)) {
    const role = jwtRole(match[1]);
    if (role === "service_role") leaks.push({ kind: "supabase-service-role", severity: "critical", file, masked: `eyJ…${match[0].slice(-4)} (role: service_role)` });
    else if (role === "anon") publicKeys.push({ kind: "supabase-anon", file });
  }
  if (/\bpk_live_[0-9A-Za-z]{24,}/.test(text)) publicKeys.push({ kind: "stripe-publishable", file });
  if (/\bsb_publishable_[0-9A-Za-z_-]{20,}/.test(text)) publicKeys.push({ kind: "supabase-publishable", file });
  return { leaks, publicKeys };
}

const shortPath = (url: string, host: string) => { const parsed = new URL(url); return parsed.hostname === host ? parsed.pathname : url; };

export async function checkSite(input: string, deps: { fetcher?: Fetcher; resolve?: Resolver } = {}): Promise<LeakReport> {
  const fetcher = deps.fetcher ?? fetch, resolve = deps.resolve ?? assertPublicHost;
  const start = normalizeSiteUrl(input);
  const page = await fetchPublic(start, LIMITS.htmlBytes, fetcher, resolve).catch(error => { if (error instanceof LeakCheckError) throw error; throw new LeakCheckError("The site could not be reached.", 422); });
  if (!page) throw new LeakCheckError("The site did not return a page.", 422);
  const host = page.url.hostname;
  const leaks: Leak[] = [], publicKeys: PublicKey[] = [];
  let bytes = page.body.length, files = 1, partial = false;
  const record = (text: string, file: string) => { const found = scanText(text, file); leaks.push(...found.leaks); publicKeys.push(...found.publicKeys); };
  record(page.body, shortPath(page.url.toString(), host));
  const scripts = scriptUrls(page.body, page.url);
  if (scripts.length >= LIMITS.scripts) partial = true;
  const results = await Promise.allSettled(scripts.map(src => fetchPublic(new URL(src), LIMITS.scriptBytes, fetcher, async (h) => { if (h !== host) throw new LeakCheckError("off-site"); await resolve(h); })));
  for (const [index, result] of results.entries()) {
    if (result.status !== "fulfilled" || !result.value) { partial = true; continue; }
    if (bytes + result.value.body.length > LIMITS.totalBytes) { partial = true; break; }
    bytes += result.value.body.length; files++;
    record(result.value.body, shortPath(scripts[index], host));
  }
  const unique = <T,>(items: T[], key: (item: T) => string) => [...new Map(items.map(item => [key(item), item])).values()];
  return { url: `https://${host}${start.pathname === "/" ? "" : start.pathname}`, host, files, bytes, partial,
    leaks: unique(leaks, leak => `${leak.kind}:${leak.masked}`).sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1)),
    publicKeys: unique(publicKeys, key => key.kind) };
}
