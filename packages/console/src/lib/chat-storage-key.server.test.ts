import assert from "node:assert/strict";
import { afterEach, test } from "vitest";

import { deriveChatStorageKey } from "./chat-storage-key.server.ts";

const originalNodeEnv = process.env["NODE_ENV"];

afterEach(() => {
  delete process.env["COCORE_CHAT_STORAGE_SECRET"];
  if (originalNodeEnv === undefined) {
    delete process.env["NODE_ENV"];
  } else {
    process.env["NODE_ENV"] = originalNodeEnv;
  }
});

/** A secret long enough to clear the production strength floor. */
const STRONG_SECRET = "x".repeat(48);

test("deriveChatStorageKey is stable for the same DID and secret", () => {
  process.env["COCORE_CHAT_STORAGE_SECRET"] = "test-secret";
  const a = deriveChatStorageKey("did:plc:alice");
  const b = deriveChatStorageKey("did:plc:alice");
  assert.equal(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});

test("deriveChatStorageKey differs across DIDs", () => {
  process.env["COCORE_CHAT_STORAGE_SECRET"] = "test-secret";
  const alice = deriveChatStorageKey("did:plc:alice");
  const bob = deriveChatStorageKey("did:plc:bob");
  assert.notEqual(alice, bob);
});

test("deriveChatStorageKey changes when the server secret changes", () => {
  process.env["COCORE_CHAT_STORAGE_SECRET"] = "secret-a";
  const before = deriveChatStorageKey("did:plc:alice");
  process.env["COCORE_CHAT_STORAGE_SECRET"] = "secret-b";
  const after = deriveChatStorageKey("did:plc:alice");
  assert.notEqual(before, after);
});

test("production refuses to fall back to the public dev secret when unset", () => {
  process.env["NODE_ENV"] = "production";
  delete process.env["COCORE_CHAT_STORAGE_SECRET"];
  assert.throws(() => deriveChatStorageKey("did:plc:alice"), /required in production/);
});

test("production rejects a secret weaker than the strength floor", () => {
  process.env["NODE_ENV"] = "production";
  process.env["COCORE_CHAT_STORAGE_SECRET"] = "too-short";
  assert.throws(() => deriveChatStorageKey("did:plc:alice"), /at least 32 characters/);
});

test("production accepts a sufficiently strong secret", () => {
  process.env["NODE_ENV"] = "production";
  process.env["COCORE_CHAT_STORAGE_SECRET"] = STRONG_SECRET;
  const key = deriveChatStorageKey("did:plc:alice");
  assert.match(key, /^[A-Za-z0-9_-]+$/);
});
