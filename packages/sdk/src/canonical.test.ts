// Cross-language parity tests for the canonical-JSON serializer.
//
// These golden values MUST match provider/src/canonical.rs's tests
// byte-for-byte. If you change one, change the other.

import { test } from "vitest";
import assert from "node:assert/strict";
import { canonicalize, CanonicalError } from "./canonical.ts";

test("primitives", () => {
  assert.equal(canonicalize(null), "null");
  assert.equal(canonicalize(true), "true");
  assert.equal(canonicalize(false), "false");
  assert.equal(canonicalize(0), "0");
  assert.equal(canonicalize(-1), "-1");
  assert.equal(canonicalize(""), '""');
  assert.equal(canonicalize("hi"), '"hi"');
});

test("keys are sorted", () => {
  assert.equal(canonicalize({ b: 1, a: 2, c: 3 }), '{"a":2,"b":1,"c":3}');
});

test("nested keys are sorted", () => {
  assert.equal(canonicalize({ outer: { z: 1, a: 2 } }), '{"outer":{"a":2,"z":1}}');
});

test("arrays preserve order", () => {
  assert.equal(canonicalize([3, 1, 2]), "[3,1,2]");
});

test("no whitespace", () => {
  assert.equal(canonicalize({ a: [1, 2, { b: 3 }] }), '{"a":[1,2,{"b":3}]}');
});

test("string escapes", () => {
  assert.equal(canonicalize('"'), '"\\""');
  assert.equal(canonicalize("\\"), '"\\\\"');
  assert.equal(canonicalize("\n"), '"\\n"');
  assert.equal(canonicalize("\t"), '"\\t"');
  assert.equal(canonicalize(""), '"\\u0001"');
});

test("unicode passes through", () => {
  // Bytes match Rust's "café" -> 0x22 0x63 0x61 0x66 0xc3 0xa9 0x22.
  const bytes = new TextEncoder().encode(canonicalize("café"));
  assert.deepEqual(Array.from(bytes), [0x22, 0x63, 0x61, 0x66, 0xc3, 0xa9, 0x22]);
});

test("floats rejected", () => {
  assert.throws(() => canonicalize({ x: 1.5 }), CanonicalError);
});

test("golden receipt shape matches Rust", () => {
  const v = {
    model: "llama-3.1-70b",
    tokens: { in: 32, out: 128 },
    price: { amount: 12, currency: "USD" },
    startedAt: "2026-05-07T12:00:00Z",
    completedAt: "2026-05-07T12:00:03Z",
    inputCommitment: "aa",
    outputCommitment: "bb",
    requester: "did:plc:requester",
  };
  const expected =
    '{"completedAt":"2026-05-07T12:00:03Z",' +
    '"inputCommitment":"aa",' +
    '"model":"llama-3.1-70b",' +
    '"outputCommitment":"bb",' +
    '"price":{"amount":12,"currency":"USD"},' +
    '"requester":"did:plc:requester",' +
    '"startedAt":"2026-05-07T12:00:00Z",' +
    '"tokens":{"in":32,"out":128}}';
  assert.equal(canonicalize(v), expected);
});
