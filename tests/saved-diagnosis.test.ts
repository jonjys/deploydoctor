import assert from "node:assert/strict";
import test from "node:test";
import { clearDiagnosis, loadDiagnosis, SAVED_DIAGNOSIS_KEY, saveDiagnosis, type SavedDiagnosis } from "../src/lib/saved-diagnosis";

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

const saved: SavedDiagnosis = {
  id: "2f1c6a2e-7a9b-4d7e-9a43-1c2b3d4e5f60",
  log: "Cloning github.com/acme/web (Branch: main)\nModule not found: Can't resolve './components/Header'",
  diagnosis: {
    verdict: "diagnosed", title: "Module not found: ./components/Header on Linux", rootCause: "The file is header.tsx.",
    confidence: "high", evidence: ["Module not found"], steps: ["Rename the import"], patch: { file: "app/page.tsx", code: "import Header from './components/header'" },
    verify: "The next deploy log shows Compiled successfully.", missingContext: [],
  },
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
  const { diagnosis } = saved;
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
