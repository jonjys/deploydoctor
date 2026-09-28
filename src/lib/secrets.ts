/**
 * Finds live credentials by their exact published formats. Every value that leaves this module is
 * masked: the known prefix plus the last four characters, never the secret itself.
 */
export type SecretKind = "stripe-secret" | "stripe-restricted" | "stripe-webhook" | "aws-access-key" | "github-token" | "supabase-secret" | "private-key";
export type SecretMatch = { kind: SecretKind; index: number; length: number; masked: string };

const PATTERNS: Array<{ kind: SecretKind; regex: RegExp }> = [
  { kind: "stripe-secret", regex: /\b(sk_live_)([0-9A-Za-z]{24,})\b/g },
  { kind: "stripe-restricted", regex: /\b(rk_live_)([0-9A-Za-z]{24,})\b/g },
  { kind: "stripe-webhook", regex: /\b(whsec_)([0-9A-Za-z+/]{32,}={0,2})/g },
  { kind: "aws-access-key", regex: /\b(AKIA)([0-9A-Z]{16})\b/g },
  { kind: "github-token", regex: /\b(ghp_)([0-9A-Za-z]{36})\b/g },
  { kind: "github-token", regex: /\b(github_pat_)([0-9A-Za-z]{22}_[0-9A-Za-z]{59})\b/g },
  { kind: "supabase-secret", regex: /\b(sb_secret_)([0-9A-Za-z_-]{20,})/g },
  // A header followed by a real base64 body, on the next line or after an escaped \n in a string.
  { kind: "private-key", regex: /(-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----)((?:\\r|\\n|\s)+[A-Za-z0-9+/]{40,})/g },
];

const PLACEHOLDER_WORD = /x{4,}|\*{3,}|\.{3}|…|example|your|placeholder|dummy|sample|fake|redacted|changeme|replace|insert|here|test/i;
const SEQUENCE = /0123456789|123456789|abcdefghij|ABCDEFGHIJ/;

/** Obvious placeholders: filler words, long runs of one character, counting sequences or too few distinct characters. */
function isPlaceholder(body: string): boolean {
  const compact = body.replace(/\\[rn]|[\s\\]/g, "");
  return PLACEHOLDER_WORD.test(compact) || SEQUENCE.test(compact) || /(.)\1{5,}/.test(compact) || new Set(compact).size < 10;
}

export function maskSecret(kind: SecretKind, prefix: string, body: string): string {
  if (kind === "private-key") return `${prefix}…`;
  return `${prefix}…${body.slice(-4)}`;
}

export function findSecrets(source: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const { kind, regex } of PATTERNS) {
    for (const match of source.matchAll(regex)) {
      const [whole, prefix, body] = match;
      if (isPlaceholder(body)) continue;
      matches.push({ kind, index: match.index, length: whole.length, masked: maskSecret(kind, prefix, body) });
    }
  }
  return matches.sort((left, right) => left.index - right.index);
}

/** Replaces every secret in `text` with its masked form. */
export function maskSecrets(text: string): string {
  let out = text;
  for (const match of findSecrets(text).reverse()) {
    out = out.slice(0, match.index) + match.masked + out.slice(match.index + match.length);
  }
  return out;
}
