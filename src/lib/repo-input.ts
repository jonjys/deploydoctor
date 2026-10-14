const REPO_INPUT = /^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/)?([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?(?:\/(?:tree|blob)\/[^\s?#]*)?\/?(?:[?#]\S*)?$/i;

/**
 * What people paste or link with ?repo=, as https://github.com/owner/name: owner/name, github.com/owner/name,
 * a full URL with www, a trailing slash or .git, or a branch or file link (/tree/x, /blob/x). Anything else gives "".
 */
export function repoUrlFromParam(value: string | null | undefined): string {
  const match = REPO_INPUT.exec((value ?? "").trim());
  if (!match || /^(?:www\.)?github\.com$/i.test(match[1])) return "";
  return `https://github.com/${match[1]}/${match[2]}`;
}
