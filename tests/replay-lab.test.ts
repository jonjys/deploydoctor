import assert from "node:assert/strict";
import test from "node:test";
import { deliverSample, freshLab, restartWorker } from "../src/lib/replay-lab";

test("repeated deliveries grant access once only with duplicate protection", () => {
  let state = freshLab();
  for (let i = 0; i < 5; i++) state = deliverSample(state);
  assert.deepEqual([state.naive, state.memory, state.transaction], [5, 1, 1]);
});
test("a worker restart loses memory protection but preserves a committed purchase", () => {
  const state = deliverSample(restartWorker(deliverSample(freshLab())));
  assert.deepEqual([state.naive, state.memory, state.transaction], [2, 2, 1]);
});
test("claim-before-work loses a grant on crash; an atomic rollback permits retry", () => {
  const state = deliverSample(deliverSample(freshLab(), "evt_demo_1", "cs_demo_1", true));
  assert.deepEqual([state.naive, state.memory, state.transaction], [1, 0, 1]);
});
test("different event IDs for the same purchase do not duplicate the purchase grant", () => {
  const state = deliverSample(deliverSample(freshLab()), "evt_demo_2");
  assert.deepEqual([state.naive, state.memory, state.transaction], [2, 2, 1]);
  const next = deliverSample(state, "evt_demo_3", "cs_demo_2");
  assert.equal(next.transaction, 2);
});
