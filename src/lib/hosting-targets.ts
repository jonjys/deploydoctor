import type { RepositorySnapshot } from "@/lib/analyzer";

export const HOST_CONFIG_FILE = /(?:^|\/)(?:netlify\.toml|wrangler\.(?:toml|jsonc?)|railway\.(?:toml|json)|Dockerfile(?:\.[\w-]+)?|\.assetsignore|\.dockerignore|_redirects)$|^\.railway\/railway\.ts$/;
export function hostingPlatforms(files: Iterable<string>): string[] {
  const paths = new Set([...files].filter(p => !/(?:^|\/)(?:tests?|__tests__|fixtures|__fixtures__|node_modules|vendor)\//i.test(p)));
  return [...(paths.has("vercel.json") ? ["Vercel"] : []), ...([...paths].some(p => /(?:^|\/)netlify\.toml$/.test(p)) ? ["Netlify"] : []),
    ...([...paths].some(p => /(?:^|\/)wrangler\.(?:toml|jsonc?)$/.test(p)) ? ["Cloudflare"] : []),
    ...([...paths].some(p => /(?:^|\/)railway\.(?:json|toml)$|^\.railway\/railway\.ts$/.test(p)) ? ["Railway"] : []), ...(paths.has("Dockerfile") ? ["Docker"] : [])];
}
export function hasAlternativeHost(s: Pick<RepositorySnapshot, "entries">): boolean {
  const hosts = hostingPlatforms(s.entries.map(e => e.path));
  return hosts.length > 0 && !hosts.includes("Vercel");
}

