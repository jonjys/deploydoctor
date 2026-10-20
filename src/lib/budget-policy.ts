export type BudgetRule = { key: string; limit: number; seconds: number };
export const PAID_DIAGNOSES_PER_DAY = 10;
export const AI_SITE_DIAGNOSES_PER_DAY = 40;
export const AI_MAX_OUTPUT_TOKENS = 2000;
export function diagnosisRules(identity: string, paid: boolean): BudgetRule[] {
  return [
    { key: "ai:site:day", limit: AI_SITE_DIAGNOSES_PER_DAY, seconds: 86400 },
    { key: `ai:${identity}:day`, limit: paid ? PAID_DIAGNOSES_PER_DAY : 1, seconds: 86400 },
    { key: `ai:${identity}:minute`, limit: 2, seconds: 60 },
  ];
}
export function githubRules(): BudgetRule[] {
  return [{ key: "github:site:hour", limit: 4000, seconds: 3600 }, { key: "github:site:minute", limit: 200, seconds: 60 }];
}
export function detectionRules(identity: string): BudgetRule[] {
  return [{ key: `detect:${identity}`, limit: 10, seconds: 60 }, { key: "detect:site", limit: 50, seconds: 60 }];
}
export function mailRules(recipient: string): BudgetRule[] {
  return [{ key: `watch:mail:${recipient}:cooldown`, limit: 1, seconds: 900 },
    { key: `watch:mail:${recipient}:day`, limit: 3, seconds: 86400 }, { key: "watch:mail:site", limit: 100, seconds: 86400 }];
}

/** Shared across instances, unlike the previous in-memory patch limiter. */
export function patchRules(identity: string, stage: "prepare" | "checkout" | "restore" | "delivery"): BudgetRule[] {
  const limits = { prepare: [6, 60], checkout: [6, 60], restore: [5, 30], delivery: [30, 120] } as const;
  return [{ key: `patch:${stage}:${identity}`, limit: limits[stage][0], seconds: 60 },
    { key: `patch:${stage}:site`, limit: limits[stage][1], seconds: 60 }];
}
