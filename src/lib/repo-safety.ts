import { maskAllSecrets } from "@/lib/secrets";

/**
 * "Is this GitHub repo safe to run?": read-only red flags in a repository's files, for people about to download
 * or run something from GitHub. Nothing is executed. A static check can show suspicious code; it can never prove
 * code is safe, and the result says so.
 */

export type Severity = "high" | "medium" | "low" | "info";
export type RepoFinding = { id: string; severity: Severity; title: string; detail: string; file?: string; line?: number; excerpt?: string };
export type RepoMeta = { fullName: string; createdAt?: string | null; stars?: number; ownerCreatedAt?: string | null; archived?: boolean; fork?: boolean };
export type RepoSafetyReport = {
  repo: string;
  verdict: "red-flags" | "check" | "no-red-flags";
  headline: string;
  findings: RepoFinding[];
  counts: Record<Severity, number>;
  filesRead: number;
  filesInRepo: number;
  partial: boolean;
};

/** Files worth reading for this check: code, scripts, manifests, docs and CI. */
export const SAFETY_FILE = /\.(?:[cm]?[jt]sx?|py|pyw|sh|bash|zsh|ps1|psm1|bat|cmd|vbs|rb|php|go|rs|lua|pl)$|(?:^|\/)(?:package\.json|setup\.py|setup\.cfg|pyproject\.toml|requirements[^/]*\.txt|Makefile|Dockerfile|README[^/]*|INSTALL[^/]*)$|^\.github\/workflows\/[^/]+\.ya?ml$/i;
const DOC_FILE = /(?:^|\/)(?:README|INSTALL)[^/]*$|\.md$/i;
const NOT_RUN_BY_USER = /(?:^|\/)(?:node_modules|vendor|third_party|dist|build|tests?|__tests__|spec|specs|fixtures?|e2e|ci)\/|^\.github\/|\.min\.js$|\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const EXECUTABLE = /\.(?:exe|dll|scr|msi|com|pif|bat|cmd|ps1|vbs|vbe|jse|wsf|lnk|jar|apk|dmg|pkg|appimage|deb|rpm)$/i;
const ARCHIVE = /\.(?:zip|rar|7z|tar\.gz|tgz)$/i;

/** Smallest first: a repository's own install hooks and docs matter more than vendored code. */
export function safetyPriority(path: string): number {
  if (/(?:^|\/)(?:package\.json|setup\.py|pyproject\.toml)$/.test(path)) return 0;
  if (/^(?:README|INSTALL)/i.test(path)) return 1;
  if (/(?:^|\/)(?:node_modules|vendor|dist|build|third_party)\//.test(path)) return 9;
  if (/\.min\.js$/.test(path)) return 8;
  return /\//.test(path) ? 4 : 2;
}

type Rule = { id: string; severity: Severity; title: string; detail: string; pattern: RegExp; docs?: "skip" | "low" };
const LINE_RULES: Rule[] = [
  { id: "download-exec", severity: "medium", title: "Downloads code and runs it straight away", detail: "Whatever that address serves runs on your computer, and it can change at any time after you read this repo. Real installers do this too: check the address belongs to the project.",
    pattern: /\b(?:curl|wget)\b[^\n|]{0,300}\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|\b(?:iwr|irm|invoke-webrequest|invoke-restmethod)\b[^\n]{0,300}\|\s*(?:iex|invoke-expression)\b|\biex\s*\(\s*(?:new-object\s+net\.webclient|\(new-object)[^\n]{0,120}downloadstring/i, docs: "low" },
  { id: "encoded-powershell", severity: "high", title: "Runs a hidden (encoded) PowerShell command", detail: "-EncodedCommand hides what the command does. Legitimate tools rarely need it.",
    pattern: /\bpowershell(?:\.exe)?\b[^\n]{0,120}\s-(?:e|en|enc|encodedcommand)\s+[A-Za-z0-9+/=]{40,}/i },
  { id: "lolbin-download", severity: "high", title: "Uses a Windows system tool to download a file", detail: "certutil, mshta and bitsadmin downloads are a well-known way for malware to slip past antivirus.",
    pattern: /\bcertutil(?:\.exe)?\b[^\n]{0,80}-urlcache|\bmshta(?:\.exe)?\s+https?:|\bbitsadmin\b[^\n]{0,80}\/transfer/i },
  { id: "eval-decoded", severity: "high", title: "Decodes hidden text and runs it as code", detail: "Code that is base64- or hex-encoded and then executed is hidden on purpose: you cannot read what it does without decoding it.",
    pattern: /\beval\s*\(\s*(?:atob|unescape|decodeURIComponent)\s*\(|\beval\s*\(\s*Buffer\.from\([^)]{0,4000}['"](?:base64|hex)['"]|\bnew\s+Function\s*\(\s*(?:atob|Buffer\.from)\b|\beval\s*\(\s*String\.fromCharCode\s*\(|\bexec\s*\(\s*(?:base64\.b(?:64|32|16)decode|zlib\.decompress|marshal\.loads|bytes\.fromhex|codecs\.decode)\s*\(|\bexec\s*\(\s*__import__\s*\(\s*['"](?:base64|zlib|marshal)['"]/ },
  { id: "exfil-endpoint", severity: "high", title: "Sends data to a chat webhook or paste site", detail: "Discord and Telegram webhooks and paste sites are where stolen passwords, tokens and wallet keys are usually sent.",
    pattern: /https?:\/\/(?:(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/|api\.telegram\.org\/bot|pastebin\.com\/(?:raw\/|api)|hastebin\.com|transfer\.sh|webhook\.site|[a-z0-9-]+\.ngrok(?:-free)?\.(?:io|app)|requestbin\.|[a-z0-9-]+\.m\.pipedream\.net)/i, docs: "skip" },
  { id: "credential-paths", severity: "high", title: "Reads browser passwords, cookies, crypto wallets or SSH keys", detail: "These files hold saved passwords, logged-in sessions and wallet keys. A tool that needs them should say exactly why.",
    pattern: /(?:Login Data|Web Data|Local State)['"\\/]|User Data[\\/]+Default[\\/]+(?:Cookies|Network)|discord[^\n]{0,60}Local Storage[\\/]+leveldb|nkbihfbeogaeaoehlefnkodbefgpgknn|wallet\.dat\b|\\Exodus\\|Electrum[\\/]+wallets|\.ssh[\\/]+id_(?:rsa|ed25519)\b|Telegram Desktop[\\/]+tdata/i, docs: "skip" },
  { id: "env-dump", severity: "medium", title: "Collects every environment variable at once", detail: "Environment variables usually hold API keys. Sending all of them anywhere is a classic way to steal them.",
    pattern: /JSON\.stringify\(\s*process\.env\s*\)|json\.dumps\(\s*(?:dict\()?os\.environ\b|base64[^\n]{0,40}process\.env\b(?!\.)|str\(\s*os\.environ\s*\)/, docs: "skip" },
  { id: "raw-ip", severity: "medium", title: "Talks to a bare IP address", detail: "Real services use domain names. A hard-coded IP address is often a private server the author controls.",
    pattern: /https?:\/\/(?!(?:127|10|0)\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|localhost)(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\//, docs: "skip" },
  { id: "clipboard-wallet", severity: "medium", title: "Watches the clipboard for crypto addresses", detail: "Clipboard 'clippers' swap the wallet address you copy for the attacker's.",
    pattern: /(?:clipboard|pyperclip|GetClipboardData)[^\n]{0,200}(?:bc1|0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})|(?:bc1|0x\[a-fA-F0-9\]\{40\})[^\n]{0,200}clipboard/i, docs: "skip" },
  { id: "av-disable", severity: "high", title: "Tells you to turn off your antivirus", detail: "No honest download needs Windows Defender or your antivirus switched off. This is the most common instruction in malware repos.",
    pattern: /\b(?:disable|turn off|deactivate|pause)\b[^\n]{0,40}\b(?:your\s+)?(?:anti-?virus|windows defender|defender|real-?time protection|smartscreen)\b|\badd\b[^\n]{0,30}\bexclusion\b[^\n]{0,40}\bdefender\b/i },
  { id: "zip-password", severity: "high", title: "Download is a password-protected archive", detail: "Archives with a password in the README are used so antivirus and GitHub cannot scan what is inside.",
    pattern: /\b(?:zip|rar|7z|archive)\b[^\n]{0,80}\bpass(?:word)?\b\s*[:=-]\s*\S{2,}|\bpass(?:word)?\b\s*[:=]\s*\S{2,}[^\n]{0,60}\b(?:zip|rar|7z|archive|extract)\b/i },
];

const INSTALL_HOOK = /^(?:preinstall|install|postinstall|prepare|prepublish|preuninstall|postuninstall)$/;
const RISKY_HOOK = /\bcurl\b|\bwget\b|https?:\/\/|powershell|invoke-webrequest|\bnode\s+-e\b|\bbash\s+-c\b|\bsh\s+-c\b|base64|\beval\b/i;

function excerpt(line: string): string {
  const trimmed = line.trim().replace(/\s{2,}/g, " ");
  const cut = trimmed.length > 180 ? `${trimmed.slice(0, 177)}…` : trimmed;
  return maskAllSecrets(cut.replace(/[A-Za-z0-9+/=]{120,}/g, m => `${m.slice(0, 24)}…(${m.length} characters)`));
}

function packageHooks(path: string, source: string): RepoFinding[] {
  let scripts: Record<string, unknown> = {};
  try { scripts = (JSON.parse(source) as { scripts?: Record<string, unknown> }).scripts ?? {}; } catch { return []; }
  const out: RepoFinding[] = [];
  for (const [name, command] of Object.entries(scripts)) {
    if (!INSTALL_HOOK.test(name) || typeof command !== "string") continue;
    const risky = RISKY_HOOK.test(command);
    out.push({ id: `hook-${path}-${name}`, severity: risky ? "high" : "low", title: risky ? `Runs a download or hidden command when installed (${name})` : `Runs a script automatically when installed (${name})`,
      detail: risky ? "npm runs this the moment you install the package, before you have used it. It reaches out to the network or runs encoded code." : "npm runs this the moment you install the package. Usually harmless (building, setup), but read the script it calls.",
      file: path, excerpt: excerpt(`"${name}": "${command}"`) });
  }
  return out;
}

function pythonInstallHooks(path: string, source: string): RepoFinding[] {
  if (!/(?:^|\/)setup\.py$/.test(path)) return [];
  if (!/\bcmdclass\b|\bclass\s+\w+\(\s*(?:install|develop|egg_info)\s*\)/.test(source)) return [];
  const network = /\b(?:urllib|requests|http\.client|socket|subprocess|os\.system)\b/.test(source);
  return [{ id: `pyhook-${path}`, severity: network ? "high" : "low", title: network ? "setup.py runs custom code with network or shell access when installed" : "setup.py runs custom code when installed",
    detail: "pip runs setup.py during install. Custom install commands are where malicious Python packages hide their payload.", file: path }];
}

const HIDDEN_RIGHT = /^[^\n]{0,200}\S[ \t]{150,}\S/;

export function analyzeRepoSafety(input: { repo: string; entries: Array<{ path: string; type: string; size?: number }>; contents: Map<string, string>; partial: boolean; meta?: RepoMeta; now?: number }): RepoSafetyReport {
  const findings: RepoFinding[] = [];
  const seen = new Map<string, number>();
  const push = (finding: RepoFinding) => {
    const count = seen.get(finding.id.replace(/-.*$/, "")) ?? 0;
    if (count >= 4) return; // a few examples per kind are enough
    seen.set(finding.id.replace(/-.*$/, ""), count + 1);
    findings.push(finding);
  };

  for (const [path, source] of input.contents) {
    if (/(?:^|\/)package\.json$/.test(path) && !/(?:^|\/)node_modules\//.test(path)) for (const f of packageHooks(path, source)) push(f);
    for (const f of pythonInstallHooks(path, source)) push(f);
    // Vendored and minified code, tests and CI are not what a user runs; they are noise for this check.
    if (NOT_RUN_BY_USER.test(path)) continue;
    const isDoc = DOC_FILE.test(path);
    const lines = source.split("\n");
    for (let index = 0; index < lines.length && index < 20_000; index++) {
      const line = lines[index];
      if (line.length > 20_000) continue;
      for (const rule of LINE_RULES) {
        if (isDoc && rule.docs === "skip") continue;
        if (!isDoc && (rule.id === "av-disable" || rule.id === "zip-password")) continue;
        if (!rule.pattern.test(line)) continue;
        // An install command quoted as text (a docs page, a help message) is shown to people, not run by the code.
        const asText = rule.id === "download-exec" && /["'`][^"'`]{0,200}\b(?:curl|wget|iwr|irm|invoke-webrequest)\b/i.test(line);
        const soft = (isDoc || asText) && rule.docs === "low";
        const severity: Severity = soft ? "low" : rule.severity;
        const title = soft ? "Install instructions pipe a download into a shell" : rule.title;
        const detail = soft ? "Common for real tools too, but read the script at that address before you run it." : rule.detail;
        push({ id: `${rule.id}-${path}-${index + 1}`, severity, title, detail, file: path, line: index + 1, excerpt: excerpt(line) });
      }
      if (!isDoc && HIDDEN_RIGHT.test(line)) push({ id: `hidden-${path}-${index + 1}`, severity: "high", title: "Code hidden far to the right of a line", detail: "Hundreds of spaces push the rest of this line off-screen, so it looks innocent in an editor or on GitHub. That trick has no honest use.", file: path, line: index + 1, excerpt: excerpt(line.replace(/[ \t]{150,}/, " ⟶ ")) });
    }
  }

  const blobs = input.entries.filter(entry => entry.type === "blob");
  const executables = blobs.filter(entry => EXECUTABLE.test(entry.path) && !/(?:^|\/)(?:test|tests|fixtures?|examples?)\//i.test(entry.path));
  const archives = blobs.filter(entry => ARCHIVE.test(entry.path));
  const binaries = executables.filter(entry => /\.(?:exe|dll|scr|msi|com|pif|lnk|jar|apk|dmg|pkg|appimage|deb|rpm)$/i.test(entry.path));
  if (binaries.length) push({ id: "binaries", severity: binaries.length && blobs.length < 30 ? "high" : "medium", title: `Ready-to-run programs are committed (${binaries.length})`, detail: `${binaries.slice(0, 4).map(b => b.path).join(", ")}${binaries.length > 4 ? "…" : ""}. A .exe in a repo cannot be read or checked here: you would be running whatever the author compiled.${blobs.length < 30 ? " A small repo that is mostly a download is the typical shape of a malware lure." : ""}` });
  if (archives.length) push({ id: "archives", severity: "low", title: `Archives are committed (${archives.length})`, detail: `${archives.slice(0, 3).map(a => a.path).join(", ")}. Their contents were not checked.` });

  const meta = input.meta;
  const now = input.now ?? Date.now();
  const days = (iso?: string | null) => (iso ? Math.floor((now - Date.parse(iso)) / 86_400_000) : null);
  const repoAge = days(meta?.createdAt), ownerAge = days(meta?.ownerCreatedAt);
  if (ownerAge !== null && ownerAge < 30) push({ id: "owner-new", severity: "medium", title: `The account that owns it is ${ownerAge} day${ownerAge === 1 ? "" : "s"} old`, detail: "Malware repos are usually published from brand-new accounts that disappear after a few weeks." });
  if (repoAge !== null && repoAge < 60 && (meta?.stars ?? 0) >= 200) push({ id: "stars-fast", severity: "medium", title: `${meta!.stars} stars in ${repoAge} days`, detail: "Stars can be bought. A new repo with many stars and few real issues or contributors is a common trick to look trustworthy." });
  if (repoAge !== null && repoAge >= 365) push({ id: "repo-age", severity: "info", title: `Repository is ${Math.floor(repoAge / 365)} year${repoAge >= 730 ? "s" : ""} old`, detail: "Age alone proves nothing, but most malware repos are weeks old." });

  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const verdict = counts.high ? "red-flags" : counts.medium ? "check" : "no-red-flags";
  const headline = counts.high ? `${counts.high} red flag${counts.high === 1 ? "" : "s"}: don't run it until you have read these lines`
    : counts.medium ? "A few things to read before you run it" : "No red flags in these checks";
  return { repo: input.repo, verdict, headline, findings, counts, filesRead: input.contents.size, filesInRepo: blobs.length, partial: input.partial };
}
