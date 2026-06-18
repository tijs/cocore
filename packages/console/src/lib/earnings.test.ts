import { describe, expect, it } from "vitest";

import type { LedgerEvent } from "./exchange-balance.server.ts";
import { sumReceiptInSince } from "./earnings.ts";

const NOW = Date.parse("2026-06-10T12:00:00Z");
const WINDOW = NOW - 24 * 60 * 60 * 1000;

function ev(kind: string, tokensDelta: number, hoursAgo: number): LedgerEvent {
  return {
    did: "did:plc:test",
    kind,
    tokensDelta,
    balanceAfter: 0,
    reference: null,
    createdAt: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
  };
}

describe("sumReceiptInSince", () => {
  it("sums receipt-in credits within the window", () => {
    expect(sumReceiptInSince([ev("receipt-in", 10, 1), ev("receipt-in", 5, 23)], WINDOW)).toBe(15);
  });

  it("ignores non receipt-in kinds (grants, refreshes, receipt-out)", () => {
    expect(
      sumReceiptInSince(
        [ev("receipt-out", 10, 1), ev("grant", 100, 1), ev("refresh", 7, 1)],
        WINDOW,
      ),
    ).toBe(0);
  });

  it("ignores events older than the window", () => {
    expect(sumReceiptInSince([ev("receipt-in", 10, 25)], WINDOW)).toBe(0);
  });

  it("ignores negative deltas", () => {
    expect(sumReceiptInSince([ev("receipt-in", -3, 1)], WINDOW)).toBe(0);
  });

  it("is zero for an empty ledger", () => {
    expect(sumReceiptInSince([], WINDOW)).toBe(0);
  });
});
