// Unit tests for statsForVisibleRows — the requester-side spend rollup.
// Regression guard: charges are denominated in CC (tokens), not USD; the
// earlier `currency === "USD"` filter dropped every real charge and the
// spend metrics read 0.

import assert from "node:assert/strict";
import { test } from "vitest";

import { statsForVisibleRows } from "./jobs.shared.ts";
import type { RequesterJobRow } from "./jobs.shared.ts";

function row(
  status: RequesterJobRow["status"],
  charged: { amount: number; currency: string } | null,
): RequesterJobRow {
  return {
    jobUri: `at://did:plc:x/dev.cocore.compute.job/${Math.random().toString(36).slice(2)}`,
    jobRkey: "j",
    model: "m",
    inputCommitmentShort: "abc",
    createdAt: "2026-06-12T20:48:00Z",
    expiresAt: "2026-06-12T21:00:00Z",
    priceCeiling: { amount: 1000, currency: "CC" },
    status,
    providerDid: "did:plc:p",
    providerHandle: null,
    providerDisplayName: null,
    receiptUri: status === "completed" ? "at://did:plc:p/dev.cocore.compute.receipt/r" : null,
    startedAt: null,
    completedAt: null,
    charged,
    tokensIn: null,
    tokensOut: null,
  };
}

test("CC charges are summed as tokens (regression: the USD filter dropped them)", () => {
  const stats = statsForVisibleRows([
    row("completed", { amount: 46, currency: "CC" }),
    row("completed", { amount: 90, currency: "CC" }),
  ]);
  assert.equal(stats.completed, 2);
  assert.equal(stats.spendTokens, 136);
});

test("the CC amount is summed raw (no /100 minor-unit division)", () => {
  const stats = statsForVisibleRows([row("completed", { amount: 46, currency: "CC" })]);
  assert.equal(stats.spendTokens, 46);
});

test("non-CC (legacy USD) charges are not counted toward the token spend", () => {
  const stats = statsForVisibleRows([row("completed", { amount: 500, currency: "USD" })]);
  assert.equal(stats.completed, 1);
  assert.equal(stats.spendTokens, 0);
});

test("pending/expired jobs are tallied but never add spend", () => {
  const stats = statsForVisibleRows([
    row("pending", null),
    row("expired", null),
    row("completed", { amount: 46, currency: "CC" }),
  ]);
  assert.equal(stats.pending, 1);
  assert.equal(stats.expired, 1);
  assert.equal(stats.completed, 1);
  assert.equal(stats.spendTokens, 46);
});
