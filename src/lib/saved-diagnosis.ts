import type { Diagnosis } from "@/lib/ai-diagnose";

// Type only, so no server code reaches the browser; the saved diagnosis tests are typed by the same schema.
export type { Diagnosis };

/**
 * The last diagnosis in this tab, with its log and the id its solved answer is stored under. A log the paywall stopped
 * waits alone, with diagnosis null and no id, so it is back in the form after the pass is bought.
 */
export type SavedDiagnosis = { id: string; log: string; diagnosis: Diagnosis | null };

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const SAVED_DIAGNOSIS_KEY = "dd-last-diagnosis";

const VERDICTS: Diagnosis["verdict"][] = ["diagnosed", "needs_more_context", "not_a_build_log"];
const CONFIDENCES: Diagnosis["confidence"][] = ["high", "medium", "low"];
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

function isDiagnosis(value: unknown): value is Diagnosis {
  const item = value as Partial<Diagnosis> | null;
  return typeof item === "object" && item !== null
    && VERDICTS.includes(item.verdict as Diagnosis["verdict"]) && CONFIDENCES.includes(item.confidence as Diagnosis["confidence"])
    && typeof item.title === "string" && typeof item.rootCause === "string" && typeof item.verify === "string"
    && strings(item.evidence) && strings(item.steps) && strings(item.missingContext)
    && typeof item.patch?.file === "string" && typeof item.patch?.code === "string";
}

// The rescue offer and the paywall send the visitor to Stripe in the same tab, so the diagnosis or the stopped log waits in
// sessionStorage for the way back.
// Storage can be missing or blocked; reads then find nothing and writes are skipped.
export function loadDiagnosis(store?: Store): SavedDiagnosis | null {
  try {
    const saved = JSON.parse((store ?? sessionStorage).getItem(SAVED_DIAGNOSIS_KEY) ?? "null") as Partial<SavedDiagnosis> | null;
    if (!saved || typeof saved.log !== "string") return null;
    if (saved.diagnosis === null) return saved.log.trim() ? { id: "", log: saved.log, diagnosis: null } : null;
    if (typeof saved.id !== "string" || !saved.id || !isDiagnosis(saved.diagnosis)) return null;
    return { id: saved.id, log: saved.log, diagnosis: saved.diagnosis };
  } catch {
    return null;
  }
}

export function saveDiagnosis(saved: SavedDiagnosis, store?: Store) {
  try { (store ?? sessionStorage).setItem(SAVED_DIAGNOSIS_KEY, JSON.stringify(saved)); } catch { /* not kept, still shown */ }
}

export function clearDiagnosis(store?: Store) {
  try { (store ?? sessionStorage).removeItem(SAVED_DIAGNOSIS_KEY); } catch { /* nothing to clear */ }
}
