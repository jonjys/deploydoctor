/**
 * Free daily allowances without a pass, per UTC day. reserve_scan counts repository scans in the database; any pass is unlimited.
 * Build-log diagnosis is free and does not reserve a scan. The GitHub Action gives each public repository one scan per day.
 * diagnoseAllowance remains so a caller cannot silently reuse the old one-a-day key.
 */
export const FREE_SCANS_PER_DAY = 1;
export const FREE_DIAGNOSES_PER_DAY = 1;
export const FREE_ACTION_SCANS_PER_DAY = 1;

/** What one free reservation counts against: a key (the visitor's IP hash when left out) and that key's daily limit. */
export type Allowance = { key?: string; limit: number };

/** A repository scan without a pass: the workflow's repository for a free Action scan, otherwise the visitor. */
export function scanAllowance(oidcRepo: string | null): Allowance {
  return oidcRepo ? { key: `repo:${oidcRepo.toLowerCase()}`, limit: FREE_ACTION_SCANS_PER_DAY } : { limit: FREE_SCANS_PER_DAY };
}

/** An AI diagnosis without a pass, counted under its own key so it never uses up the visitor's scan. */
export function diagnoseAllowance(ipHash: string): Allowance {
  return { key: `diagnose:${ipHash}`, limit: FREE_DIAGNOSES_PER_DAY };
}
