// Pure helpers for provider earnings, split out from the bridge client
// so they're unit-testable without touching the network.

import type { LedgerEvent } from "./exchange-balance.server.ts";

/** Sum provider income — `receipt-in` credits — at or after `sinceMs`.
 *  Negative deltas and other event kinds are ignored. Order-independent,
 *  side-effect-free. */
export function sumReceiptInSince(events: LedgerEvent[], sinceMs: number): number {
  return events.reduce((sum, e) => {
    if (e.kind !== "receipt-in") return sum;
    if (new Date(e.createdAt).getTime() < sinceMs) return sum;
    return sum + Math.max(0, e.tokensDelta);
  }, 0);
}
