import { assertPublicHost, fetchPublic, inspectSite, LeakCheckError, LEAK_COPY, type Fetcher, type Resolver } from "@/lib/bundle-leaks";
import { viesCheck, type ViesVerdict } from "@/lib/vies";
import { LEGAL_COPY, type AiFinding, type LegalFinding, type LegalKey, type SiteCheckReport, type SiteFinding, type VatFinding } from "@/lib/site-check-copy";

/**
 * Live site check: the leak check, plus what a buyer, the EU and an AI assistant read on the same live site.
 * Every request to the site goes through the leak check's SSRF-safe fetcher and stays on the site's own host.
 * Nothing is stored. The only other host contacted is VIES, once, and only when the footer shows a VAT number.
 *
 * The homepage is attacker-controlled input of up to 2 MB, so nothing here runs a regular expression whose cost
 * grows faster than the input: elements are found by index with every closing tag located once, and every
 * pattern that scans text has bounded quantifiers.
 */

export type SiteCheckDeps = { fetcher?: Fetcher; resolve?: Resolver; vies?: typeof viesCheck; nonce?: string; probeBudgetMs?: number };

const PROBE_BYTES = 64_000;
const ROBOTS_BYTES = 200_000;
/** Robots.txt and the policy probes share this much time after the leak check, so the whole check stays inside maxDuration. */
const PROBE_BUDGET_MS = 20_000;
/** Larger pages are analysed by their first and last 300 KB: navigation, footer and head live there. */
const ANALYSIS_BYTES = 600_000;
const MAX_ELEMENTS = 5000;
const MAX_TAG = 4000;

function analysable(html: string): string {
  return html.length <= ANALYSIS_BYTES ? html : `${html.slice(0, ANALYSIS_BYTES / 2)}\n${html.slice(-ANALYSIS_BYTES / 2)}`;
}

type Element = { start: number; end: number; attrs: string; inner: string };

/**
 * Elements named `tag`, in document order, in linear time. An element without a closing tag has an empty inner
 * text; inner texts over `maxInner` characters are skipped. Nested elements of the same name are not paired.
 */
export function elements(html: string, tag: string, maxInner = 20_000): Element[] {
  const opens = [...html.matchAll(new RegExp(`<${tag}(?=[\\s/>])`, "gi"))].slice(0, MAX_ELEMENTS).map(match => match.index!);
  if (!opens.length) return [];
  const closes = [...html.matchAll(new RegExp(`</${tag}\\s{0,20}>`, "gi"))].map(match => ({ at: match.index!, end: match.index! + match[0].length }));
  const ends: number[] = [];
  for (let index = html.indexOf(">"); index >= 0; index = html.indexOf(">", index + 1)) ends.push(index);
  const out: Element[] = [];
  let endCursor = 0, closeCursor = 0;
  for (const start of opens) {
    while (endCursor < ends.length && ends[endCursor] < start) endCursor++;
    const tagEnd = ends[endCursor];
    if (tagEnd === undefined || tagEnd - start > MAX_TAG) continue;
    while (closeCursor < closes.length && closes[closeCursor].at < tagEnd) closeCursor++;
    const close = closes[closeCursor];
    const attrs = html.slice(start + tag.length + 1, tagEnd);
    if (close && close.at - tagEnd - 1 <= maxInner) out.push({ start, end: close.end, attrs, inner: html.slice(tagEnd + 1, close.at) });
    else out.push({ start, end: tagEnd + 1, attrs, inner: "" });
  }
  return out;
}

function decode(text: string): string {
  return text.replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&#64;|&commat;/gi, "@");
}

/** Visible text: scripts and styles removed, tags replaced by spaces. Linear: no pattern can backtrack past the next '<' or '>'. */
export function stripTags(html: string): string {
  const skip = [...elements(html, "script", Infinity), ...elements(html, "style", Infinity)].sort((a, b) => a.start - b.start);
  let text = "", at = 0;
  for (const block of skip) {
    if (block.start < at) continue;
    text += html.slice(at, block.start) + " ";
    at = block.end;
  }
  text += html.slice(at);
  return decode(text.replace(/<[^<>]*>/g, " ")).replace(/\s+/g, " ");
}

function hrefOf(attrs: string): string {
  const match = attrs.match(/\bhref\s{0,10}=\s{0,10}(?:"([^"]{0,2000})"|'([^']{0,2000})'|([^\s>]{1,2000}))/i);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

/** Links as address path (query and fragment dropped: "?returnTo=" is not a returns page) and visible text. */
function links(html: string): { href: string; path: string; text: string }[] {
  return elements(html, "a", 4000).map(link => {
    const href = hrefOf(link.attrs);
    return { href, path: decode(href.split(/[?#]/)[0]), text: stripTags(link.inner).trim() };
  });
}

/** Each pattern needs a word start, so "Danger" is not "ånger" and "Customer" is not "ust". Swedish compounds are matched inside words. */
const LEGAL_WORDS: Record<LegalKey, RegExp> = {
  privacy: /integritet|personuppgift|(?<![\p{L}])(?:privacy|dataskydd|datenschutz|confidentialit|privacidad|privacybeleid|tietosuoja|personvern|gdpr)/iu,
  terms: /villkor|vilk[aå]r|(?<![\p{L}])(?:terms|conditions|agb|cgv|gesch[aä]ftsbedingungen|condiciones|voorwaarden|ehdot|tos)(?![\p{L}])/iu,
  returns: /[aå]ngerr[aä]tt|(?<![\p{L}])(?:returns?|refunds?|retur(?:er|nera)?|ånger|widerruf|r[eé]tractation|devoluci[oó]n|herroep|reklamation|peruutus|fortrydelse)(?![\p{L}])/iu,
  contact: /(?<![\p{L}])(?:contact|kontakt|kontakta|impressum|yhteystiedot|contacto|contatti|kundservice|kundtjänst|customer service)(?![\p{L}])/iu,
};
const LEGAL_KEYS: LegalKey[] = ["privacy", "terms", "returns", "contact"];
const EMAIL = /[\w.+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,5}\.[a-z]{2,24}(?![\w-])/i;

/** Legal and contact links on the homepage, by link path or link text, in the main EU languages. */
export function legalLinks(rawHtml: string): Record<LegalKey, boolean> {
  const html = analysable(rawHtml);
  const all = links(html);
  const has = (key: LegalKey) => all.some(link => LEGAL_WORDS[key].test(link.path) || LEGAL_WORDS[key].test(link.text));
  const contactLink = all.some(link => /^(?:mailto|tel):/i.test(link.href) || link.path.includes("/cdn-cgi/l/email-protection"));
  return {
    privacy: has("privacy"), terms: has("terms"), returns: has("returns"),
    // Cloudflare replaces addresses with data-cfemail; a version string such as react@18.2.0 has no letter TLD.
    contact: has("contact") || contactLink || /\bdata-cfemail\s{0,5}=/i.test(html) || EMAIL.test(stripTags(html)),
  };
}

const BUY_WORDS = /(?<![\p{L}])(?:checkout|pricing|prices|buy|shop|shop now|cart|basket|order now|subscribe|plans|köp|handla|kassa|priser|beställ|varukorg|warenkorb|kaufen|panier|acheter|comprar|carrito)(?![\p{L}])/iu;
const BUY_PATHS = /(?:^|\/)(?:checkout|cart|basket|pricing|prices|products?|collections|shop|store|kassa|varukorg|priser)(?:\/|$)/i;

/** A shop: buy wording in a link or button's text, a shop path in a link, or a live Stripe publishable key. Class names and attributes are ignored. */
export function sellsOnline(rawHtml: string, hasStripeKey: boolean): boolean {
  if (hasStripeKey) return true;
  const html = analysable(rawHtml);
  if (links(html).some(link => BUY_WORDS.test(link.text) || BUY_PATHS.test(link.path))) return true;
  return elements(html, "button", 2000).some(button => BUY_WORDS.test(stripTags(button.inner)));
}

/** VAT number body per member state, as VIES accepts it (after the country prefix). */
const VAT_BODY: Record<string, RegExp> = {
  AT: /^U\d{8}$/, BE: /^[01]\d{9}$/, BG: /^\d{9,10}$/, CY: /^\d{8}[A-Z]$/, CZ: /^\d{8,10}$/, DE: /^\d{9}$/,
  DK: /^\d{8}$/, EE: /^\d{9}$/, EL: /^\d{9}$/, ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/, FI: /^\d{8}$/,
  FR: /^[A-HJ-NP-Z0-9]{2}\d{9}$/, HR: /^\d{11}$/, HU: /^\d{8}$/, IE: /^(\d{7}[A-W][A-IW]?|\d[A-Z+*]\d{5}[A-W])$/,
  IT: /^\d{11}$/, LT: /^(\d{9}|\d{12})$/, LU: /^\d{8}$/, LV: /^\d{11}$/, MT: /^\d{8}$/, NL: /^\d{9}B\d{2}$/,
  PL: /^\d{10}$/, PT: /^\d{9}$/, RO: /^\d{2,10}$/, SE: /^\d{12}$/, SI: /^\d{8}$/, SK: /^\d{10}$/,
  XI: /^(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
};
/** VAT labels as whole words (VAT, Moms, Momsreg.nr, USt-IdNr, UID, MwSt, TVA, IVA, P.IVA, BTW, ...). */
const VAT_LABEL = /(?<![\p{L}])(?:vat|moms\p{L}{0,24}|mva|alv|ust(?:-?id(?:nr)?)?|mwst|umsatzsteuer\p{L}{0,20}|uid|tva|iva|p\.\s?iva|btw|dph|dič|dic|nip|pvm|pdv|áfa|ddv)(?![\p{L}])/iu;
const BANK_LABEL = /(?<![\p{L}])(?:iban|bic|swift|bankgiro|plusgiro|konto|account)(?![\p{L}])/iu;
const VAT_CANDIDATE = /\b(AT|BE|BG|CY|CZ|DE|DK|EE|EL|GR|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI)([\s.-]?)((?:[0-9A-Z+*][\s.-]?){7,16})/g;
const ITALIAN_PIVA = /(?<![\p{L}])(?:p\.\s?iva|partita\s{1,3}iva)\s{0,3}[:.]?\s{0,3}(\d{11})(?!\d)/iu;

/**
 * Cuts a captured run into a VAT number. Only cuts at a separator (a space, dot or dash in the original) or at the
 * end are tried, so an IBAN or a longer number is never shortened into a valid-looking one. A capital letter that
 * starts the next word ("DE123456789Telefon") is dropped.
 */
function vatBody(countryCode: string, captured: string, nextChar: string): string | null {
  let run = captured.replace(/[\s.-]+$/, "");
  if (/[A-Z]$/.test(run) && /\p{Ll}/u.test(nextChar)) run = run.slice(0, -1);
  const cuts: number[] = [];
  let compact = "";
  for (const char of run) {
    if (/[\s.-]/.test(char)) { cuts.push(compact.length); continue; }
    compact += char;
  }
  cuts.push(compact.length);
  for (const cut of [...new Set(cuts)].sort((a, b) => b - a)) {
    const body = compact.slice(0, cut);
    if (VAT_BODY[countryCode].test(body)) return body;
  }
  return null;
}

function vatIn(text: string): { countryCode: string; vatNumber: string } | null {
  for (const match of text.matchAll(VAT_CANDIDATE)) {
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 40), index);
    if (!VAT_LABEL.test(before) || BANK_LABEL.test(text.slice(Math.max(0, index - 16), index))) continue;
    const countryCode = match[1] === "GR" ? "EL" : match[1];
    const vatNumber = vatBody(countryCode, match[3], text.charAt(index + match[0].length));
    if (vatNumber) return { countryCode, vatNumber };
  }
  const italian = text.match(ITALIAN_PIVA);
  return italian ? { countryCode: "IT", vatNumber: italian[1] } : null;
}

/**
 * The site's own EU VAT number: next to a VAT label in a footer (the last footer first, since dialogs and
 * testimonials can carry their own), or, on a page without a footer, in its last 3000 characters. Numbers elsewhere
 * are as likely a demo or a customer example.
 */
export function findVatNumber(rawHtml: string): { countryCode: string; vatNumber: string } | null {
  const html = analysable(rawHtml);
  const footers = elements(html, "footer", 200_000).filter(footer => footer.inner);
  for (const footer of [...footers].reverse()) {
    const found = vatIn(stripTags(footer.inner));
    if (found) return found;
  }
  // A page with a footer prints its details there; only a page without one is read from its end.
  return footers.length ? null : vatIn(stripTags(html).slice(-3000));
}

/** Crawlers that fetch pages for AI search answers and for assistants browsing on a user's request. */
export const AI_SEARCH_BOTS = ["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User"];
/** Crawlers that collect training data only. Blocking them is an opt-out that, per their operators, does not affect search answers. */
export const AI_TRAINING_BOTS = ["GPTBot", "ClaudeBot", "Google-Extended", "CCBot"];

type Rule = { allow: boolean; path: string };
type Group = { agents: string[]; rules: Rule[] };

function parseRobots(robots: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let inRules = false;
  for (const raw of robots.split(/\r?\n/).slice(0, 5000)) {
    const line = raw.replace(/#.*/, "").trim();
    const colon = line.indexOf(":");
    if (!line || colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase(), value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!current || inRules) { current = { agents: [], rules: [] }; groups.push(current); inRules = false; }
      current.agents.push(value.toLowerCase());
    } else if (current && (key === "allow" || key === "disallow")) {
      inRules = true;
      // An empty Disallow allows everything: it is no rule (RFC 9309 2.2.2).
      if (value) current.rules.push({ allow: key === "allow", path: value.slice(0, 500) });
    } else if (current) {
      inRules = true;
    }
  }
  return groups;
}

/**
 * RFC 9309 path matching: "*" matches any run of characters, a final "$" anchors the end, otherwise the rule is a
 * prefix. Greedy two-pointer glob matching, so a pattern full of "*" cannot backtrack exponentially as a RegExp would.
 */
export function pathMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const glob = anchored ? pattern.slice(0, -1) : `${pattern}*`;
  let g = 0, p = 0, star = -1, mark = 0;
  while (p < path.length) {
    if (g < glob.length && glob[g] !== "*" && glob[g] === path[p]) { g++; p++; }
    else if (g < glob.length && glob[g] === "*") { star = g++; mark = p; }
    else if (star >= 0) { g = star + 1; p = ++mark; }
    else return false;
  }
  while (g < glob.length && glob[g] === "*") g++;
  return g === glob.length;
}

/** RFC 9309: every group naming the agent is merged; otherwise the "*" groups apply; the longest matching rule wins, Allow on a tie. */
function allowed(groups: Group[], agent: string, path: string): boolean {
  const own = groups.filter(group => group.agents.includes(agent.toLowerCase()));
  const rules = (own.length ? own : groups.filter(group => group.agents.includes("*"))).flatMap(group => group.rules);
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!pathMatches(rule.path, path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return !best || best.allow;
}

/** An agent counts as blocked when it may not fetch the homepage or a typical page ("Disallow: /admin" blocks nobody here). */
const blocked = (groups: Group[], agent: string) => !allowed(groups, agent, "/") || !allowed(groups, agent, "/products/example-page");

export function robotsFindings(robots: string | null): Pick<AiFinding, "googleBlocked" | "blockedBots" | "trainingOptOut"> {
  if (!robots) return { googleBlocked: false, blockedBots: [], trainingOptOut: [] };
  const groups = parseRobots(robots);
  return {
    googleBlocked: blocked(groups, "Googlebot"),
    blockedBots: AI_SEARCH_BOTS.filter(bot => blocked(groups, bot)),
    trainingOptOut: AI_TRAINING_BOTS.filter(bot => blocked(groups, bot)),
  };
}

/** schema.org types declared in JSON-LD (objects, arrays, @graph) or microdata itemtype. Invalid JSON-LD blocks are skipped. */
export function schemaTypes(rawHtml: string): string[] {
  const html = analysable(rawHtml);
  const types = new Set<string>();
  const visit = (node: unknown, depth: number) => {
    if (depth > 4 || types.size > 20 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const item of node.slice(0, 50)) visit(item, depth + 1); return; }
    const record = node as Record<string, unknown>;
    const type = record["@type"];
    for (const value of Array.isArray(type) ? type : [type]) if (typeof value === "string" && /^[A-Za-z]{2,40}$/.test(value)) types.add(value);
    if (record["@graph"]) visit(record["@graph"], depth + 1);
  };
  for (const script of elements(html, "script", 200_000)) {
    if (!/\btype\s{0,10}=\s{0,10}["']?application\/ld\+json/i.test(script.attrs)) continue;
    try { visit(JSON.parse(script.inner.trim()), 0); } catch { /* not valid JSON-LD */ }
  }
  for (const match of html.matchAll(/\bitemtype\s{0,10}=\s{0,10}["']?https?:\/\/schema\.org\/([A-Za-z]{2,40})/gi)) if (types.size <= 20) types.add(match[1]);
  return [...types];
}

const normalPath = (path: string) => path.replace(/\/+$/, "").toLowerCase() || "/";

type Getter = (path: string, limit: number) => Promise<{ url: URL; body: string } | null>;

/**
 * A fetcher for one host: the leak check's SSRF guard, never another host (even through a redirect), a shared
 * deadline, and the HTTP status of every request so a 5xx can be told apart from a 404.
 */
function sameHost(host: string, fetcher: Fetcher, resolve: Resolver, budgetMs: number) {
  const deadline = AbortSignal.timeout(budgetMs);
  const statuses = new Map<string, number>();
  const guard: Resolver = async target => { if (target !== host) throw new LeakCheckError("off-site"); await resolve(target); };
  const timed: Fetcher = async (url, init) => {
    try {
      const response = await fetcher(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
      statuses.set(new URL(url).pathname, response.status);
      return response;
    } catch (error) {
      statuses.set(new URL(url).pathname, 0);
      throw error;
    }
  };
  const get: Getter = (path, limit) => fetchPublic(new URL(path, `https://${host}`), limit, timed, guard).catch(() => null);
  return { get, statuses, expired: () => deadline.aborted };
}

/** A page counts only when it answers 200 at that very path: a redirect to the homepage or anywhere else does not. */
async function exists(get: Getter, path: string): Promise<boolean> {
  const page = await get(path, PROBE_BYTES);
  return !!page && normalPath(page.url.pathname) === normalPath(path);
}

/** Where platforms put these pages when the footer is rendered by JavaScript (Shopify policies first). */
export const LEGAL_PATHS: Record<LegalKey, string[]> = {
  privacy: ["/policies/privacy-policy", "/privacy", "/privacy-policy"],
  terms: ["/policies/terms-of-service", "/terms", "/kopvillkor", "/villkor"],
  returns: ["/policies/refund-policy", "/returns", "/refund-policy"],
  contact: ["/policies/contact-information", "/pages/contact", "/contact", "/kontakt"],
};

/**
 * Looks for pages the homepage does not link, one address at a time per page type, stopping at the first hit.
 * Nothing is looked for when the site answers 200 for made-up addresses: then nothing could be proven.
 */
export async function probeLegal(get: Getter, linked: Record<LegalKey, boolean>, nonce: string, expired: () => boolean = () => false)
  : Promise<{ legal: Record<LegalKey, LegalFinding>; search: SiteCheckReport["legalSearch"] }> {
  const legal = Object.fromEntries(LEGAL_KEYS.map(key => [key, { found: linked[key], where: linked[key] ? "homepage" : null }])) as Record<LegalKey, LegalFinding>;
  const missing = LEGAL_KEYS.filter(key => !linked[key]);
  if (!missing.length) return { legal, search: "complete" };
  const soft = await Promise.all([`/deploydoctor-404-${nonce}`, `/pages/deploydoctor-404-${nonce}`].map(path => exists(get, path)));
  if (soft.some(Boolean)) return { legal, search: "soft-404" };
  await Promise.all(missing.map(async key => {
    for (const path of LEGAL_PATHS[key]) {
      if (expired()) return;
      if (await exists(get, path)) { legal[key] = { found: true, where: path }; return; }
    }
  }));
  return { legal, search: expired() && missing.some(key => !legal[key].found) ? "timed-out" : "complete" };
}

function vatFinding(number: { countryCode: string; vatNumber: string }, verdict: ViesVerdict): VatFinding {
  return { ...number, verdict: verdict ? (verdict.valid ? "valid" : "invalid") : "unknown", name: verdict?.name ?? null };
}

const MISSING_DETAIL: Record<SiteCheckReport["legalSearch"], string> = {
  complete: "Not linked from the homepage, and not at the usual addresses for your platform.",
  "soft-404": "Not linked from the homepage. Your site answers every address with a page, so we could not look further.",
  "timed-out": "Not linked from the homepage. Your site was too slow to look at every usual address, so this may be a miss.",
};

/** Plain-language findings in a fixed order: keys, trust, VAT, AI. */
export function buildFindings(report: Omit<SiteCheckReport, "findings" | "summary">): SiteFinding[] {
  const findings: SiteFinding[] = [];
  const add = (finding: SiteFinding) => findings.push(finding);

  const { leaks } = report;
  const seen = new Map<string, number>();
  for (const leak of leaks.leaks) {
    const count = (seen.get(leak.kind) ?? 0) + 1;
    seen.set(leak.kind, count);
    add({ id: count === 1 ? `leak-${leak.kind}` : `leak-${leak.kind}-${count}`, area: "keys", status: leak.severity === "critical" ? "fail" : "warn",
      title: `${LEAK_COPY[leak.kind].name} is public`, detail: `${leak.masked} in ${leak.file}`, fix: LEAK_COPY[leak.kind].fix });
  }
  if (!leaks.leaks.length) {
    const scripts = leaks.files - 1;
    add({ id: "leak-none", area: "keys", status: leaks.partial ? "warn" : "pass",
      title: leaks.partial ? "No secret keys in the files we could read" : scripts > 0 ? "No secret keys in your live JavaScript" : "No secret keys in the page",
      detail: scripts > 0
        ? `The page and ${scripts} JavaScript ${scripts === 1 ? "file" : "files"} read${leaks.partial ? "; some files could not be read or were over the size limit" : ""}.`
        : "Only the page itself was read: it loads no JavaScript files from the same site." });
  }

  for (const key of LEGAL_KEYS) {
    if (key === "returns" && !report.sellsOnline) continue;
    const found = report.legal[key];
    const { name, fix } = LEGAL_COPY[key];
    if (found.found) {
      add({ id: `legal-${key}`, area: "trust", status: "pass", title: `${name} found`,
        detail: (found.where === "homepage" ? "Linked from the homepage." : `At ${found.where}. Not linked in the homepage HTML, which is normal when a footer is rendered by JavaScript; check it shows on the page.`)
          + (key === "contact" ? " We did not check that it shows your company name and address." : "") });
    } else {
      add({ id: `legal-${key}`, area: "trust", status: key === "privacy" ? "fail" : "warn", title: `No ${name.toLowerCase()} found`, detail: MISSING_DETAIL[report.legalSearch], fix });
    }
  }

  if (report.vat) {
    const number = `${report.vat.countryCode}${report.vat.vatNumber}`;
    if (report.vat.verdict === "valid") add({ id: "vat", area: "vat", status: "pass", title: `VAT number ${number} is valid in VIES`, detail: report.vat.name ? `Registered to ${report.vat.name}.` : "This member state does not disclose the registered name." });
    else if (report.vat.verdict === "invalid") add({ id: "vat", area: "vat", status: "fail", title: `VAT number ${number} is not valid in VIES`, detail: "The European Commission's VIES service says this number is not valid for intra-EU trade. Business customers who check it will see the same.",
      fix: "Compare the number on the page with your registration digit by digit. If it is right, ask your tax office to register it for intra-EU (VIES) trade." });
    else add({ id: "vat", area: "vat", status: "info", title: `VAT number ${number} found, not checked`, detail: "VIES did not answer for this member state just now. Member states go offline independently; try again later." });
  } else {
    add({ id: "vat", area: "vat", status: "info", title: "No EU VAT number found in the footer", detail: "Only needed if you are VAT-registered in the EU. Business buyers look for it before paying." });
  }

  const { ai } = report;
  const optOut = ai.trainingOptOut.length ? ` You opt out of AI training (${ai.trainingOptOut.join(", ")}); that does not affect search answers.` : "";
  if (ai.robotsTxt === "error") {
    add({ id: "ai-robots", area: "ai", status: "info", title: "robots.txt could not be read", detail: "It answered with a server error or not at all, so crawler access was not checked. Google treats a robots.txt server error as \"do not crawl\" until it recovers." });
  } else if (ai.googleBlocked) {
    add({ id: "ai-robots", area: "ai", status: "fail", title: "robots.txt blocks Google", detail: `Googlebot may not fetch your pages${ai.blockedBots.length ? `, and neither may ${ai.blockedBots.join(", ")}` : ""}.${optOut}`,
      fix: "Remove the Disallow rule that covers Googlebot (often \"Disallow: /\" under \"User-agent: *\") unless the site is meant to stay out of search." });
  } else if (ai.blockedBots.length) {
    add({ id: "ai-robots", area: "ai", status: "warn", title: "robots.txt blocks AI search crawlers", detail: `Blocked: ${ai.blockedBots.join(", ")}. ChatGPT, Claude and Perplexity cannot read or recommend pages these crawlers may not fetch.${optOut}`,
      fix: "Remove those Disallow rules unless you mean them. To stay out of AI training only, block GPTBot, ClaudeBot, Google-Extended and CCBot instead: their operators say those do not power search answers." });
  } else {
    add({ id: "ai-robots", area: "ai", status: "pass", title: "Google and AI search crawlers may read your site",
      detail: (ai.robotsTxt === "found" ? "robots.txt does not block Googlebot, OAI-SearchBot, Claude-SearchBot or PerplexityBot." : "There is no robots.txt, so nothing is blocked.") + optOut });
  }
  if (ai.schemaTypes.length) {
    add({ id: "ai-schema", area: "ai", status: "pass", title: "Structured data found", detail: `schema.org types: ${ai.schemaTypes.slice(0, 8).join(", ")}.` });
  } else {
    add({ id: "ai-schema", area: "ai", status: "warn", title: "No structured data on the homepage", detail: "No schema.org JSON-LD or microdata, so Google and AI assistants have to guess your name, what you sell and your prices.",
      fix: "Add an Organization block in JSON-LD to the homepage, and Product blocks with offers.price and offers.priceCurrency on product pages." });
  }
  return findings;
}

export async function checkLiveSite(input: string, deps: SiteCheckDeps = {}): Promise<SiteCheckReport> {
  const fetcher = deps.fetcher ?? fetch, resolve = deps.resolve ?? assertPublicHost;
  const { report: leaks, page } = await inspectSite(input, { fetcher, resolve });
  const host = page.url.hostname;
  const { get, statuses, expired } = sameHost(host, fetcher, resolve, deps.probeBudgetMs ?? PROBE_BUDGET_MS);
  const html = page.body;
  const vatNumber = findVatNumber(html);
  const nonce = deps.nonce ?? crypto.randomUUID().slice(0, 8);

  const [robots, probed, verdict] = await Promise.all([
    get("/robots.txt", ROBOTS_BYTES),
    probeLegal(get, legalLinks(html), nonce, expired),
    vatNumber ? (deps.vies ?? viesCheck)(vatNumber) : Promise.resolve(null),
  ]);
  // An SPA that serves its index page for /robots.txt has no robots.txt; a 5xx or no answer is not "no robots.txt".
  const robotsStatus = statuses.get("/robots.txt");
  const robotsText = robots && !/^\s*</.test(robots.body) ? robots.body : null;
  const robotsTxt: AiFinding["robotsTxt"] = robotsText ? "found" : robots || (robotsStatus !== undefined && robotsStatus >= 400 && robotsStatus < 500) ? "missing" : "error";
  const base = {
    url: leaks.url, host, leaks, legal: probed.legal, legalSearch: probed.search,
    sellsOnline: sellsOnline(html, leaks.publicKeys.some(key => key.kind === "stripe-publishable")),
    vat: vatNumber ? vatFinding(vatNumber, verdict) : null,
    ai: { robotsTxt, ...robotsFindings(robotsText), schemaTypes: schemaTypes(html) },
  };
  const findings = buildFindings(base);
  const count = (status: SiteFinding["status"]) => findings.filter(finding => finding.status === status).length;
  return { ...base, findings, summary: { fail: count("fail"), warn: count("warn"), pass: count("pass") } };
}
