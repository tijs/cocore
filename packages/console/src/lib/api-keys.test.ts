import { beforeEach, test } from "vitest";
import assert from "node:assert/strict";

import {
  createKey,
  deleteKey,
  generateApiKey,
  hashKey,
  listKeysForDid,
  resolveBearerKey,
  revokeKey,
} from "./api-keys.server.ts";
import { consoleDb } from "./console-db.server.ts";

beforeEach(() => {
  consoleDb().exec("DELETE FROM api_keys");
});

test("generated keys have the cocore- prefix and high entropy", () => {
  const a = generateApiKey();
  const b = generateApiKey();
  assert.match(a.full, /^cocore-[A-Za-z0-9_-]{30,}$/);
  assert.notEqual(a.full, b.full);
  assert.notEqual(a.hash, b.hash);
  assert.equal(a.prefix, a.full.slice(0, "cocore-".length + 8));
});

test("hashKey is deterministic and matches generated hash", () => {
  const k = generateApiKey();
  assert.equal(hashKey(k.full), k.hash);
});

test("create/list/revoke lifecycle", () => {
  const did = "did:plc:alice";
  const created = createKey({ did, name: "laptop" });
  assert.equal(created.key.did, did);
  assert.equal(created.key.name, "laptop");
  assert.equal(created.key.revokedAt, null);
  assert.match(created.secret, /^cocore-/);

  const list = listKeysForDid(did);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.id, created.key.id);

  const ok = revokeKey({ id: created.key.id, did });
  assert.equal(ok, true);
  const after = listKeysForDid(did);
  assert.notEqual(after[0]!.revokedAt, null);
});

test("revoke is scoped to the owning DID", () => {
  const created = createKey({ did: "did:plc:alice", name: "laptop" });
  const ok = revokeKey({ id: created.key.id, did: "did:plc:bob" });
  assert.equal(ok, false);
  assert.equal(listKeysForDid("did:plc:alice")[0]!.revokedAt, null);
});

test("deleteKey hard-deletes the row", () => {
  const did = "did:plc:alice";
  const created = createKey({ did, name: "laptop" });
  assert.equal(listKeysForDid(did).length, 1);

  const ok = deleteKey({ id: created.key.id, did });
  assert.equal(ok, true);
  assert.equal(listKeysForDid(did).length, 0);

  // Subsequent delete on the same id is a no-op.
  assert.equal(deleteKey({ id: created.key.id, did }), false);
});

test("deleteKey is scoped to the owning DID", () => {
  const created = createKey({ did: "did:plc:alice", name: "laptop" });
  // Bob can't delete Alice's key.
  assert.equal(deleteKey({ id: created.key.id, did: "did:plc:bob" }), false);
  assert.equal(listKeysForDid("did:plc:alice").length, 1);
});

test("deleteKey works on already-revoked keys (cleanup path)", () => {
  const did = "did:plc:alice";
  const created = createKey({ did, name: "old" });
  revokeKey({ id: created.key.id, did });
  assert.notEqual(listKeysForDid(did)[0]!.revokedAt, null);

  // Now delete — row goes away regardless of revoked state.
  const ok = deleteKey({ id: created.key.id, did });
  assert.equal(ok, true);
  assert.equal(listKeysForDid(did).length, 0);
});

test("resolveBearerKey returns the owning DID and bumps last_used_at", () => {
  const did = "did:plc:alice";
  const created = createKey({ did, name: "laptop" });
  const resolved = resolveBearerKey(created.secret);
  assert.ok(resolved);
  assert.equal(resolved!.did, did);
  assert.equal(resolved!.id, created.key.id);
  const after = listKeysForDid(did);
  assert.notEqual(after[0]!.lastUsedAt, null);
});

test("resolveBearerKey rejects unknown, revoked, expired, and malformed", () => {
  // Unknown
  assert.equal(resolveBearerKey("cocore-not-a-real-key"), null);
  // Malformed (missing prefix)
  assert.equal(resolveBearerKey("definitely-not-a-cocore-key"), null);

  // Revoked
  const revoked = createKey({ did: "did:plc:alice", name: "old" });
  revokeKey({ id: revoked.key.id, did: "did:plc:alice" });
  assert.equal(resolveBearerKey(revoked.secret), null);

  // Expired
  const expired = createKey({
    did: "did:plc:alice",
    name: "expired",
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  assert.equal(resolveBearerKey(expired.secret), null);
});

test("resolveBearerKey honors a future expiresAt", () => {
  const future = createKey({
    did: "did:plc:alice",
    name: "future",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.ok(resolveBearerKey(future.secret));
});
