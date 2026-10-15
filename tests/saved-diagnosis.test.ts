import assert from "node:assert/strict";
import test from "node:test";
import { clearDiagnosis, type Diagnosis, loadDiagnosis, SAVED_DIAGNOSIS_KEY, saveDiagnosis, type SavedDiagnosis } from "../src/lib/saved-diagnosis";

function memoryStore() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const blocked = {
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
  removeItem: () => { throw new Error("SecurityError"); },
};

// Typed by DiagnosisSchema in ai-diagnose, so tsc fails here when the schema changes and the checks below follow it.
const diagnosis: Diagnosis = {
  verdict: "diagnosed", title: "Module not found: ./components/Header on Linux", rootCause: "The file is header.tsx.",
  confidence: "high", evidence: ["Module not found"], steps: ["Rename the import"], patch: { file: "app/page.tsx", code: "import Header from './components/header'" },
  verify: "The next deploy log shows Compiled successfully.", missingContext: [],
};

const saved: SavedDiagnosis = {
  id: "2f1c6a2e-7a9b-4d7e-9a43-1c2b3d4e5f60",
  log: "Cloning github.com/acme/web (Branch: main)\nModule not found: Can't resolve './components/Header'",
  diagnosis,
};

test("a diagnosis saved before checkout comes back with its log and id, and is gone after Diagnose another log", () => {
  const store = memoryStore();
  assert.equal(loadDiagnosis(store), null);
  saveDiagnosis(saved, store);
  assert.deepEqual(loadDiagnosis(store), saved);
  // Saving the next diagnosis replaces the last one.
  saveDiagnosis({ ...saved, id: "next" }, store);
  assert.equal(loadDiagnosis(store)?.id, "next");
  clearDiagnosis(store);
  assert.equal(loadDiagnosis(store), null);
  assert.equal(store.items.size, 0);
});

test("a later log that fails or hits the paywall never brings back the diagnosis before it", () => {
  const store = memoryStore();
  const next = "Error: Cannot find module 'sharp'\nBuild failed because of webpack errors";
  // submit() first drops what the tab kept, so any failure leaves nothing to restore.
  saveDiagnosis(saved, store);
  clearDiagnosis(store);
  assert.equal(loadDiagnosis(store), null);
  // The paywall keeps the new log alone: back from Stripe, it is in the form and the success page offers to diagnose it.
  saveDiagnosis(saved, store);
  clearDiagnosis(store);
  saveDiagnosis({ id: "", log: next, diagnosis: null }, store);
  assert.deepEqual(loadDiagnosis(store), { id: "", log: next, diagnosis: null });
  // Diagnosing it after the purchase replaces the waiting log with the result.
  saveDiagnosis({ ...saved, log: next }, store);
  assert.deepEqual(loadDiagnosis(store), { ...saved, log: next });
});

test("a waiting log needs text and never carries an id", () => {
  const store = memoryStore();
  store.items.set(SAVED_DIAGNOSIS_KEY, JSON.stringify({ id: saved.id, log: saved.log, diagnosis: null }));
  assert.deepEqual(loadDiagnosis(store), { id: "", log: saved.log, diagnosis: null });
  for (const value of [JSON.stringify({ id: "", log: "", diagnosis: null }), JSON.stringify({ id: "", log: "  \n", diagnosis: null }),
    JSON.stringify({ id: "", log: null, diagnosis: null }), JSON.stringify({ id: "", diagnosis: null })]) {
    store.items.set(SAVED_DIAGNOSIS_KEY, value);
    assert.equal(loadDiagnosis(store), null, value);
  }
});

test("blocked or missing storage never breaks the form", () => {
  assert.doesNotThrow(() => saveDiagnosis(saved, blocked));
  assert.doesNotThrow(() => clearDiagnosis(blocked));
  assert.equal(loadDiagnosis(blocked), null);
  // Node has no sessionStorage, like a browser that refuses it.
  assert.equal(loadDiagnosis(), null);
  assert.doesNotThrow(() => saveDiagnosis(saved));
  assert.doesNotThrow(() => clearDiagnosis());
});

test("a damaged or foreign saved value shows the empty form instead of a broken result", () => {
  const store = memoryStore();
  for (const value of [
    "{", "null", "[]", "\"text\"", JSON.stringify({ ...saved, id: "" }), JSON.stringify({ ...saved, id: 7 }),
    JSON.stringify({ ...saved, log: null }), JSON.stringify({ id: saved.id, log: saved.log }),
    JSON.stringify({ ...saved, diagnosis: { ...diagnosis, verdict: "solved" } }),
    JSON.stringify({ ...saved, diagnosis: { ...diagnosis, confidence: "certain" } }),
    JSON.stringify({ ...saved, diagnosis: { ...diagnosis, steps: "Rename the import" } }),
    JSON.stringify({ ...saved, diagnosis: { ...diagnosis, evidence: [1] } }),
    JSON.stringify({ ...saved, diagnosis: { ...diagnosis, patch: null } }),
    JSON.stringify({ ...saved, diagnosis: { ...diagnosis, patch: { file: "a.ts" } } }),
    JSON.stringify({ ...saved, diagnosis: { ...diagnosis, title: undefined } }),
  ]) {
    store.items.set(SAVED_DIAGNOSIS_KEY, value);
    assert.equal(loadDiagnosis(store), null, value);
  }
});
