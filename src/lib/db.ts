import "server-only";

export async function db<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Database is not configured.");
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}),
      "Content-Type": "application/json", ...init.headers },
    cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    console.error("Database request failed", path.split("?")[0], response.status);
    throw new Error("Could not save or read data right now; try again in a moment.");
  }
  const body = await response.text();
  return (body ? JSON.parse(body) : null) as T;
}

export function query(table: string, values: Record<string, string>) {
  return `${table}?${new URLSearchParams(values)}`;
}

export function rpc<T>(name: string, data: Record<string, unknown>) {
  return db<T>(`rpc/${name}`, { method: "POST", body: JSON.stringify(data) });
}
