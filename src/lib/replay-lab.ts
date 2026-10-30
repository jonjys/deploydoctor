/** An educational state machine. No network, real payments or durable storage. */
export type LabState = {
  deliveries: number;
  naive: number;
  memory: number;
  transaction: number;
  seenEvents: string[];
  fulfilledPurchases: string[];
  log: string[];
};

export function freshLab(): LabState {
  return { deliveries: 0, naive: 0, memory: 0, transaction: 0, seenEvents: [], fulfilledPurchases: [], log: [] };
}

export function deliverSample(state: LabState, eventId = "evt_demo_1", purchaseId = "cs_demo_1", fail = false): LabState {
  const eventSeen = state.seenEvents.includes(eventId);
  const purchaseDone = state.fulfilledPurchases.includes(purchaseId);
  // The memory-only example deliberately claims before doing the work. A crash
  // loses that work, and a process restart loses the claim. This is the bug shown.
  return {
    deliveries: state.deliveries + 1,
    naive: state.naive + (fail ? 0 : 1),
    memory: state.memory + (!eventSeen && !fail ? 1 : 0),
    // Models ONE atomic DB commit of a unique purchase key AND an access grant.
    // A failure rolls both back. This does not model external email/shipping.
    transaction: state.transaction + (!purchaseDone && !fail ? 1 : 0),
    seenEvents: eventSeen ? state.seenEvents : [...state.seenEvents, eventId],
    fulfilledPurchases: purchaseDone || fail ? state.fulfilledPurchases : [...state.fulfilledPurchases, purchaseId],
    log: [`#${state.deliveries + 1} ${eventId} → ${purchaseId}: ${fail ? (purchaseDone ? "simulated crash; prior DB commit unchanged" : "crash before grant / DB rollback") : purchaseDone ? "purchase already committed; DB skips" : "DB commits one access grant"}`, ...state.log].slice(0, 6),
  };
}

export function restartWorker(state: LabState): LabState {
  return { ...state, seenEvents: [], log: ["Worker restarted: memory guard forgotten; simulated DB preserved.", ...state.log].slice(0, 6) };
}
