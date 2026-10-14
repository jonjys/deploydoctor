/**
 * The GitHub repository a Vercel build cloned, as owner/repo, from the first line of every Vercel build log:
 * `Cloning github.com/owner/repo (Branch: main, Commit: abc1234)`. Null when the log has no such line.
 */
export function clonedRepo(log: string): string | null {
  const match = /Cloning github\.com\/([\w.-]+)\/([\w.-]+) \(Branch: /.exec(log);
  return match ? `${match[1]}/${match[2]}` : null;
}
