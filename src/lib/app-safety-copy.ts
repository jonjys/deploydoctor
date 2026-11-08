/** Types for "Is my app safe?", safe to import from client components. The logic is in app-safety.ts. */

export type SafetyStatus = "fail" | "warn" | "pass" | "info";
export type SafetyArea = "keys" | "database" | "files" | "headers";
export type SafetyFinding = { id: string; area: SafetyArea; status: SafetyStatus; title: string; detail: string; fix?: string };

/** Readable by anyone with the public key: name and row count only, never rows. */
export type ExposedTable = { table: string; rows: number };

export type SafetyVerdict =
  /** At least one failed check: secrets, readable tables or public source files. */
  | "not-safe"
  /** Owner verified: every check ran, nothing failed. */
  | "no-issues"
  /** Not verified: the public checks passed, the database and file checks did not run. */
  | "public-checks-passed";

export type SafetyReport = {
  url: string;
  host: string;
  verdict: SafetyVerdict;
  owner: { verified: boolean; token: string; file: string; meta: string };
  /** Supabase project host found in the site's JavaScript, or null. */
  supabase: string | null;
  exposedTables: ExposedTable[];
  findings: SafetyFinding[];
  summary: { fail: number; warn: number; pass: number };
  partial: boolean;
};

export const AREA_NAMES: Record<SafetyArea, string> = { keys: "Secret keys", database: "Database", files: "Source files", headers: "Browser protection" };
