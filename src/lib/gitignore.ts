/**
 * Minimal .gitignore matching for one .gitignore file: comments, escapes, negation, directory-only
 * patterns, anchoring, `*`, `?`, `[...]` and `**`. Later rules win, and a file inside an ignored
 * directory cannot be re-included, as in git.
 */
export type GitignoreRule = { pattern: string; line: number; negate: boolean; directoryOnly: boolean; regex: RegExp };

function globToRegex(glob: string): string {
  let out = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const atSegmentStart = index === 0 || glob[index - 1] === "/";
    if (char === "*" && glob[index + 1] === "*" && atSegmentStart && (glob[index + 2] === "/" || index + 2 === glob.length)) {
      if (glob[index + 2] === "/") { out += "(?:.*/)?"; index += 2; } else { out += ".*"; index += 1; }
    } else if (char === "*") {
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else if (char === "[") {
      const end = glob.indexOf("]", index + 2);
      if (end === -1) { out += "\\["; continue; }
      let body = glob.slice(index + 1, end).replace(/\\/g, "\\\\");
      if (body.startsWith("!")) body = `^${body.slice(1)}`;
      out += `[${body}]`;
      index = end;
    } else if (char === "\\" && index + 1 < glob.length) {
      index += 1;
      out += glob[index].replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    } else {
      out += char.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    }
  }
  return out;
}

export function parseGitignore(text: string): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    // Trailing spaces are ignored unless escaped with a backslash.
    let pattern = raw.replace(/(?<!\\)\s+$/, "");
    if (!pattern || pattern.startsWith("#")) return;
    let negate = false;
    if (pattern.startsWith("!")) { negate = true; pattern = pattern.slice(1); }
    else if (pattern.startsWith("\\!") || pattern.startsWith("\\#")) pattern = pattern.slice(1);
    const directoryOnly = pattern.endsWith("/");
    if (directoryOnly) pattern = pattern.slice(0, -1);
    if (!pattern) return;
    // A slash anywhere but the end anchors the pattern to the .gitignore's directory.
    const anchored = pattern.includes("/");
    const body = globToRegex(pattern.replace(/^\//, ""));
    rules.push({ pattern: raw.trim(), line: index + 1, negate, directoryOnly, regex: new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`) });
  });
  return rules;
}

/** The last rule matching `path` decides; undefined means no rule matched. */
function lastMatch(rules: GitignoreRule[], path: string, isDirectory: boolean): GitignoreRule | undefined {
  let found: GitignoreRule | undefined;
  for (const rule of rules) {
    if (rule.directoryOnly && !isDirectory) continue;
    if (rule.regex.test(path)) found = rule;
  }
  return found;
}

/** Returns the rule that makes git ignore `path` (a file relative to the .gitignore), or null if it is not ignored. */
export function ignoringRule(gitignore: string | GitignoreRule[], path: string): GitignoreRule | null {
  const rules = typeof gitignore === "string" ? parseGitignore(gitignore) : gitignore;
  const segments = path.split("/");
  for (let depth = 1; depth < segments.length; depth += 1) {
    const rule = lastMatch(rules, segments.slice(0, depth).join("/"), true);
    if (rule && !rule.negate) return rule;
  }
  const rule = lastMatch(rules, path, false);
  return rule && !rule.negate ? rule : null;
}
