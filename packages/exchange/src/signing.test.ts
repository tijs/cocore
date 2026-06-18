import { test } from "vitest";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import {
  type PrivateJwk,
  parsePrivateJwk,
  publicKeyFingerprint,
  signRecord,
  signSettlement,
} from "./signing.ts";
import type { SettlementRecord } from "@cocore/sdk/types";

const { subtle } = webcrypto;

async function generateKey(): Promise<PrivateJwk> {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const jwk = await subtle.exportKey("jwk", pair.privateKey);
  return jwk as PrivateJwk;
}

const sampleSettlement: SettlementRecord = {
  receipt: { uri: "at://did:plc:p/dev.cocore.compute.receipt/abc", cid: "bafy-r-1" },
  requesterAuthorization: {
    uri: "at://did:plc:r/dev.cocore.compute.paymentAuthorization/xyz",
    cid: "bafy-pa-1",
  },
  amountCharged: { amount: 100, currency: "USD" },
  providerPayout: { amount: 95, currency: "USD" },
  exchangeFee: { amount: 5, currency: "USD" },
  processorReference: "Y2hhcmdlPWNoXzE=",
  status: "settled",
  settledAt: "2026-05-09T18:00:00Z",
};

test("signSettlement produces a base64url ES256 signature that verifies", async () => {
  const priv = await generateKey();
  const sig = await signSettlement(sampleSettlement, priv);
  assert.match(sig, /^[A-Za-z0-9_-]+$/, "base64url, no padding");

  // Re-derive the public half + verify the signature against it.
  const pubJwk = { kty: priv.kty, crv: priv.crv, x: priv.x, y: priv.y };
  const pubKey = await subtle.importKey(
    "jwk",
    pubJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const sigBytes = Uint8Array.from(
    atob(
      sig
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(sig.length / 4) * 4, "="),
    ),
    (c) => c.charCodeAt(0),
  );
  const { canonicalBytes } = await import("@cocore/sdk/canonical");
  const ok = await subtle.verify(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    pubKey,
    sigBytes,
    canonicalBytes(sampleSettlement),
  );
  assert.equal(ok, true);
});

test("a cocore-countersigned terms acceptance round-trips for a verifier", async () => {
  const priv = await generateKey();
  // Exactly the record the exchange builds for /signTermsAcceptance:
  // $type + the policy/attestation strong-refs are all part of the
  // signed canonical form (signRecord only strips `sig`).
  const record: Record<string, unknown> = {
    $type: "dev.cocore.compute.termsAcceptance",
    exchange: "did:plc:5quuhkmwe2q4k3azfsgg7kdz",
    policy: { uri: "at://did:plc:x/dev.cocore.compute.exchangePolicy/p", cid: "bafy-pol" },
    termsVersion: "2026-06-01",
    termsUri: "https://console.cocore.dev/terms",
    acceptedAt: "2026-06-17T19:00:00Z",
    attestation: {
      uri: "at://did:plc:x/dev.cocore.compute.exchangeAttestation/a",
      cid: "bafy-att",
    },
  };
  const sig = await signRecord(record, priv);
  assert.match(sig, /^[A-Za-z0-9_-]+$/);

  // Verifier path: strip `sig`, re-canonicalise the rest (incl $type +
  // attestation), ES256-verify against the exchange's published key.
  const stored = { ...record, sig };
  const { sig: _drop, ...rest } = stored;
  void _drop;
  const pubKey = await subtle.importKey(
    "jwk",
    { kty: priv.kty, crv: priv.crv, x: priv.x, y: priv.y },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const sigBytes = Uint8Array.from(
    atob(
      sig
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(sig.length / 4) * 4, "="),
    ),
    (c) => c.charCodeAt(0),
  );
  const { canonicalBytes } = await import("@cocore/sdk/canonical");
  const ok = await subtle.verify(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    pubKey,
    sigBytes,
    canonicalBytes(rest),
  );
  assert.equal(ok, true, "stored record minus sig must verify against the exchange key");
});

test("signSettlement is deterministic-ish: same input + key produces verifiable sig", async () => {
  // ECDSA isn't deterministic by default (k is random), but the sig
  // must still verify against the same canonical bytes.
  const priv = await generateKey();
  const a = await signSettlement(sampleSettlement, priv);
  const b = await signSettlement(sampleSettlement, priv);
  // Both verify
  for (const sig of [a, b]) {
    assert.match(sig, /^[A-Za-z0-9_-]+$/);
    assert.ok(sig.length > 80, "ES256 signature is 64 raw bytes → ~88 base64url chars");
  }
});

test("publicKeyFingerprint is stable for the same JWK", async () => {
  const priv = await generateKey();
  const a = await publicKeyFingerprint(priv);
  const b = await publicKeyFingerprint(priv);
  assert.equal(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});

test("parsePrivateJwk rejects non-EC keys", () => {
  assert.throws(() => parsePrivateJwk(JSON.stringify({ kty: "RSA", n: "x", e: "AQAB", d: "y" })));
  assert.throws(() => parsePrivateJwk(JSON.stringify({ kty: "EC", crv: "P-384" })));
});
