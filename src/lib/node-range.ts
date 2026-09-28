/**
 * Just enough of npm's semver range syntax to answer "does engines.node allow any of these Node majors?".
 * Returns null for anything it cannot parse, so callers never report a guess.
 */
type Version = [number, number, number];
type Comparator = (version: Version) => boolean;

function compare(left: Version, right: Version): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

const PART = /^(<=|>=|<|>|=|\^|~>?)?v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function parseComparator(text: string): Comparator[] | null {
  const match = PART.exec(text);
  if (!match) return null;
  const [, operator = "", ...raw] = match;
  const wildcard = (value?: string) => value === undefined || /^[xX*]$/.test(value);
  if (wildcard(raw[0])) return operator === "<" || operator === ">" ? [() => false] : [() => true];
  const major = Number(raw[0]);
  const minor = wildcard(raw[1]) ? null : Number(raw[1]);
  const patch = minor === null || wildcard(raw[2]) ? null : Number(raw[2]);
  const low: Version = [major, minor ?? 0, patch ?? 0];
  // The first version after the partial version: 20 -> 21.0.0, 20.1 -> 20.2.0, 20.1.2 -> 20.1.3.
  const next: Version = minor === null ? [major + 1, 0, 0] : patch === null ? [major, minor + 1, 0] : [major, minor, patch + 1];
  const atLeast = (bound: Version): Comparator => (version) => compare(version, bound) >= 0;
  const below = (bound: Version): Comparator => (version) => compare(version, bound) < 0;

  switch (operator) {
    case ">=": return [atLeast(low)];
    case ">": return [atLeast(next)];
    case "<": return [below(low)];
    case "<=": return [below(next)];
    case "^": {
      const upper: Version = major > 0 || minor === null ? [major + 1, 0, 0] : minor > 0 || patch === null ? [0, minor + 1, 0] : [0, 0, (patch ?? 0) + 1];
      return [atLeast(low), below(upper)];
    }
    case "~": case "~>": return [atLeast(low), below(minor === null ? [major + 1, 0, 0] : [major, minor + 1, 0])];
    default: return [atLeast(low), below(next)];
  }
}

function parseSet(text: string): Comparator[] | null {
  const trimmed = text.trim();
  if (!trimmed) return [() => true];
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(trimmed);
  if (hyphen) {
    const from = parseComparator(`>=${hyphen[1]}`);
    const to = parseComparator(`<=${hyphen[2]}`);
    return from && to ? [...from, ...to] : null;
  }
  const comparators: Comparator[] = [];
  // ">= 20" is the same as ">=20".
  for (const token of trimmed.replace(/(<=|>=|<|>|=|\^|~>?)\s+/g, "$1").split(/\s+/)) {
    const parsed = parseComparator(token);
    if (!parsed) return null;
    comparators.push(...parsed);
  }
  return comparators;
}

/** true/false when the range was understood, null when it was not. */
export function nodeRangeAllowsMajor(range: string, majors: number[]): boolean | null {
  const sets = range.split("||").map(parseSet);
  if (sets.some((set) => set === null)) return null;
  // Probe each major across its minors, plus every exact version the range names (pins such as 20.11.1).
  const named = [...range.matchAll(/(\d+)\.(\d+)(?:\.(\d+))?/g)].map((match): Version => [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)]);
  const probes: Version[] = [...named.filter((version) => majors.includes(version[0]))];
  for (const major of majors) {
    for (let minor = 0; minor <= 60; minor += 1) probes.push([major, minor, 0], [major, minor, 99]);
  }
  return probes.some((version) => sets.some((set) => set!.every((test) => test(version))));
}
