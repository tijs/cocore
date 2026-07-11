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
