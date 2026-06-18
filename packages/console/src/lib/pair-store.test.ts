import { test } from "vitest";
import assert from "node:assert/strict";
import { PairStore, type ProviderSession } from "./pair-store.ts";

const fakeSession: ProviderSession = {
  did: "did:plc:test",
  handle: "alice.example",
  apiKey: "cocore-test-key",
  apiBase: "https://console.example",
};

test("start issues unique device id and user code", () => {
  const store = new PairStore("http://localhost:3000");
  const a = store.start();
  const b = store.start();
  assert.notEqual(a.deviceId, b.deviceId);
  assert.notEqual(a.userCode, b.userCode);
  assert.match(a.userCode, /^[A-Z2-9]{8}$/);
  assert.equal(a.verificationUri, `http://localhost:3000/devices/new?code=${a.userCode}`);
});

test("happy path: start -> poll(pending) -> approve -> poll(session)", () => {
  const store = new PairStore("http://localhost:3000");
  const start = store.start();

  // Agent polls before user has approved.
  assert.equal(store.poll(start.deviceId).kind, "pending");

  // User approves in the browser.
  store.approve(start.userCode, fakeSession);

  // Agent polls again, gets the session, and consumes it.
  const r = store.poll(start.deviceId);
  assert.equal(r.kind, "session");
  if (r.kind === "session") assert.equal(r.session.did, fakeSession.did);

  // Subsequent polls return consumed.
  assert.equal(store.poll(start.deviceId).kind, "consumed");
});

test("user code is case-insensitive", () => {
  const store = new PairStore("http://localhost:3000");
  const start = store.start();
  const found = store.lookupByCode(start.userCode.toLowerCase());
  assert.ok(found);
  assert.equal(found?.deviceId, start.deviceId);
});

test("deny path: start -> deny -> poll(denied)", () => {
  const store = new PairStore("http://localhost:3000");
  const start = store.start();
  store.deny(start.userCode);
  assert.equal(store.poll(start.deviceId).kind, "denied");
});

test("expiry: pending past TTL becomes expired", () => {
  let now = 1_000_000;
  const store = new PairStore("http://localhost:3000", 1000, () => now);
  const start = store.start();
  now += 2000;
  assert.equal(store.poll(start.deviceId).kind, "expired");
});

test("cannot approve consumed pair", () => {
  const store = new PairStore("http://localhost:3000");
  const start = store.start();
  store.approve(start.userCode, fakeSession);
  store.poll(start.deviceId); // consume
  assert.throws(() => store.approve(start.userCode, fakeSession));
});

test("lookup by unknown code returns null", () => {
  const store = new PairStore("http://localhost:3000");
  assert.equal(store.lookupByCode("NEVERMIND"), null);
});

test("poll for unknown device returns unknown", () => {
  const store = new PairStore("http://localhost:3000");
  assert.equal(store.poll("unknown").kind, "unknown");
});
