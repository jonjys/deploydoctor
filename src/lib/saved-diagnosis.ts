export type Diagnosis = {
  verdict: "diagnosed" | "needs_more_context" | "not_a_build_log";
  title: string;
  rootCause: string;
  confidence: "high" | "medium" | "low";
  evidence: string[];
  steps: string[];
  patch: { file: string; code: string };
  verify: string;
  missingContext: string[];
};

/** The last diagnosis in this tab, with its log and the id its solved answer is stored under. */
export type SavedDiagnosis = { id: string; log: string; diagnosis: Diagnosis };

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const SAVED_DIAGNOSIS_KEY = "dd-last-diagnosis";

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

function isDiagnosis(value: unknown): value is Diagnosis {
  const item = value as Partial<Diagnosis> | null;
  return typeof item === "object" && item !== null
    && ["diagnosed", "needs_more_context", "not_a_build_log"].includes(item.verdict as string)
    && ["high", "medium", "low"].includes(item.confidence as string)
    && typeof item.title === "string" && typeof item.rootCause === "string" && typeof item.verify === "string"
    && strings(item.evidence) && strings(item.steps) && strings(item.missingContext)
    && typeof item.patch?.file === "string" && typeof item.patch?.code === "string";
}

// The rescue offer sends the visitor to Stripe in the same tab, so the diagnosis waits in sessionStorage for the way back.
// Storage can be missing or blocked; reads then find nothing and writes are skipped.
export function loadDiagnosis(store?: Store): SavedDiagnosis | null {
  try {
    const saved = JSON.parse((store ?? sessionStorage).getItem(SAVED_DIAGNOSIS_KEY) ?? "null") as Partial<SavedDiagnosis> | null;
    if (!saved || typeof saved.id !== "string" || !saved.id || typeof saved.log !== "string" || !isDiagnosis(saved.diagnosis)) return null;
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
