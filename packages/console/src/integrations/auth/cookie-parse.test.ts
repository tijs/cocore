// Pins the duplicate-cookie handling behind the host-only → Domain=cocore.dev
// cutover (commit bcf24d5): a browser that logged in before and after the
// change presents two `cocore-auth.session_token` cookies, the stale host-only
// one first. The resolver must be able to see ALL of them, not just the first.

import assert from "node:assert/strict";
import { test } from "vitest";

import {
  readAllAuthSessionTokens,
  readAuthSessionToken,
} from "@/integrations/auth/cookie-parse.ts";

test("returns every cocore-auth.session_token value in header order", () => {
  const header = "cocore-auth.session_token=stale; other=x; cocore-auth.session_token=fresh";
  assert.deepEqual(readAllAuthSessionTokens(header), ["stale", "fresh"]);
});

test("single cookie yields a one-element array", () => {
  assert.deepEqual(readAllAuthSessionTokens("cocore-auth.session_token=only"), ["only"]);
});

test("no matching cookie yields an empty array", () => {
  assert.deepEqual(readAllAuthSessionTokens("foo=1; bar=2"), []);
  assert.deepEqual(readAllAuthSessionTokens(undefined), []);
  assert.deepEqual(readAllAuthSessionTokens(""), []);
});

test("readAuthSessionToken still returns the first value (header order)", () => {
  assert.equal(
    readAuthSessionToken("cocore-auth.session_token=stale; cocore-auth.session_token=fresh"),
    "stale",
  );
  assert.equal(readAuthSessionToken("foo=1"), undefined);
});
