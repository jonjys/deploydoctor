/**
 * A branch, tag or commit SHA as git accepts it: no leading dash, no "..", no spaces or control characters.
 * Returns undefined when nothing was sent, null when the value is invalid.
 */
export function parseGitRef(input: unknown): string | undefined | null {
  if (input === undefined || input === null || input === "") return undefined;
  if (typeof input !== "string") return null;
  const ref = input.trim();
  if (ref.length > 200 || ref.startsWith("-") || ref.startsWith("/") || ref.endsWith("/") || ref.endsWith(".lock")
    || ref.includes("..") || ref.includes("//") || ref.includes("@{") || /[\s~^:?*[\\\x00-\x1f\x7f]/.test(ref)) return null;
  return ref;
}
