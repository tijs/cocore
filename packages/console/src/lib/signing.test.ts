import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { afterEach, test } from "vitest";

import { canonicalBytes } from "@cocore/sdk/canonical";

import { _resetSigningKeyCache, signRecordIfConfigured } from "./signing.server.ts";

const { subtle } = webcrypto;

interface PrivateJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  d: string;
}

async function generateJwk(): Promise<PrivateJwk> {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  return (await subtle.exportKey("jwk", pair.privateKey)) as PrivateJwk;
}

function decodeBase64Url(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function verifyWithJwk(
  jwk: PrivateJwk,
  bytes: Uint8Array,
  sigBase64Url: string,
): Promise<boolean> {
  const pub = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  const key = await subtle.importKey("jwk", pub, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "verify",
  ]);
  return subtle.verify(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    key,
    decodeBase64Url(sigBase64Url),
    bytes,
  );
}

afterEach(() => {
  delete process.env["COCORE_EXCHANGE_PRIVATE_KEY_JWK"];
  _resetSigningKeyCache();
});

test("returns null when COCORE_EXCHANGE_PRIVATE_KEY_JWK is unset", async () => {
  delete process.env["COCORE_EXCHANGE_PRIVATE_KEY_JWK"];
  _resetSigningKeyCache();
  const r = await signRecordIfConfigured({ foo: "bar" });
  assert.equal(r, null);
});

test("returns null and logs when env is set but unparseable", async () => {
  process.env["COCORE_EXCHANGE_PRIVATE_KEY_JWK"] = "{not json";
  _resetSigningKeyCache();
  const r = await signRecordIfConfigured({ foo: "bar" });
  assert.equal(r, null);
});

test("returns null when env is set but not an EC P-256 private JWK", async () => {
  process.env["COCORE_EXCHANGE_PRIVATE_KEY_JWK"] = JSON.stringify({ kty: "oct", k: "abc" });
  _resetSigningKeyCache();
  const r = await signRecordIfConfigured({ foo: "bar" });
  assert.equal(r, null);
});

test("signs a record and produces a base64url signature that verifies", async () => {
  const priv = await generateJwk();
  process.env["COCORE_EXCHANGE_PRIVATE_KEY_JWK"] = JSON.stringify(priv);
  _resetSigningKeyCache();

  const record = { a: 1, nested: { b: 2, c: ["x", "y"] }, z: "tail" };
  const sig = await signRecordIfConfigured(record);
  assert.ok(sig, "expected a signature when key is configured");
  assert.match(sig!, /^[A-Za-z0-9_-]+$/);
  const ok = await verifyWithJwk(priv, canonicalBytes(record), sig!);
  assert.equal(ok, true);
});

test("strips a pre-existing sig field before signing", async () => {
  const priv = await generateJwk();
  process.env["COCORE_EXCHANGE_PRIVATE_KEY_JWK"] = JSON.stringify(priv);
  _resetSigningKeyCache();

  const sigOverDirty = await signRecordIfConfigured({ foo: "bar", sig: "FAKE-PRIOR-SIG" });
  const sigOverClean = await signRecordIfConfigured({ foo: "bar" });
  assert.ok(sigOverDirty);
  assert.ok(sigOverClean);
  // ECDSA is non-deterministic, so we can't compare sigs directly,
  // but BOTH must verify against the same canonical bytes
  // ({foo: "bar"} without the sig field) — proving the prior sig
  // was stripped before canonicalization.
  const cleanBytes = canonicalBytes({ foo: "bar" });
  assert.equal(await verifyWithJwk(priv, cleanBytes, sigOverDirty!), true);
  assert.equal(await verifyWithJwk(priv, cleanBytes, sigOverClean!), true);
});
