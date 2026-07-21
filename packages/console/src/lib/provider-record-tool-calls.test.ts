import assert from "node:assert/strict";
import { test } from "vitest";

import { applyProviderRecordToolCalls } from "./provider-record-pds.server.ts";

test("tool calling on clears the opt-out and keeps legacy agents enabled", () => {
  const next = applyProviderRecordToolCalls({ machineLabel: "mac", toolCallsDisabled: true }, true);
  assert.equal(next["toolCalls"], true);
  assert.equal(next["toolCallsDisabled"], undefined);
  assert.equal(next["machineLabel"], "mac");
});

test("tool calling off writes the opt-out and clears the legacy opt-in", () => {
  const next = applyProviderRecordToolCalls({ machineLabel: "mac", toolCalls: true }, false);
  assert.equal(next["toolCalls"], undefined);
  assert.equal(next["toolCallsDisabled"], true);
  assert.equal(next["machineLabel"], "mac");
});

test("tool calling on is idempotent", () => {
  const first = applyProviderRecordToolCalls({ toolCalls: true }, true);
  const second = applyProviderRecordToolCalls(first, true);
  assert.equal(second["toolCalls"], true);
  assert.equal(second["toolCallsDisabled"], undefined);
});

test("tool calling off is idempotent", () => {
  const first = applyProviderRecordToolCalls({ toolCallsDisabled: true }, false);
  const second = applyProviderRecordToolCalls(first, false);
  assert.equal(second["toolCalls"], undefined);
  assert.equal(second["toolCallsDisabled"], true);
});

test("tool calling preserves unrelated fields and empty records", () => {
  const next = applyProviderRecordToolCalls({}, true);
  assert.equal(next["toolCalls"], true);
  assert.equal(next["toolCallsDisabled"], undefined);
  assert.equal(next["machineLabel"], undefined);
});

test("tool calling ignores corrupt values defensively", () => {
  const next = applyProviderRecordToolCalls({ toolCalls: "yes", toolCallsDisabled: 42 }, false);
  assert.equal(next["toolCalls"], undefined);
  assert.equal(next["toolCallsDisabled"], true);
});
