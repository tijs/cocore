// Round-trip test: generate a P-256 key with WebCrypto, build an
// attestation response that mimics what the provider would emit
// (canonical bytes + DER signature), and confirm verifyAttestation
// returns true. This guards the wire-format choices in attest.ts —
// most importantly: that the signed payload uses camelCase keys
// while the wire frame uses snake_case keys.

import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";

import { canonicalize } from "@cocore/sdk/canonical";

import type { AttestationChallenge, AttestationResponse } from "./protocol.ts";
import { isFresh, makeChallenge, signedPayloadFor, verifyAttestation } from "./attest.ts";

// Generate a fresh P-256 keypair, returning the private CryptoKey
// (typed via the node:crypto webcrypto namespace so we don't need
// the DOM lib in tsconfig) and the public key as base64-encoded
// uncompressed-without-04 bytes (the shape verifyP256 expects).
async function generateKeyPair(): Promise<{
  privateKey: webcrypto.CryptoKey;
  publicKeyB64: string;
}> {
  const kp = (await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as webcrypto.CryptoKeyPair;
  const raw = new Uint8Array(await webcrypto.subtle.exportKey("raw", kp.publicKey));
  if (raw[0] !== 0x04 || raw.byteLength !== 65) {
    throw new Error(`unexpected raw export shape (${raw.byteLength}B, leading=${raw[0]})`);
  }
  const xy = raw.slice(1);
  const publicKeyB64 = bytesToBase64(xy);
  return { privateKey: kp.privateKey, publicKeyB64 };
}

function bytesToBase64(b: Uint8Array): string {
  let bin = "";
  for (const byte of b) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function rawSigToDer(raw: Uint8Array): Uint8Array {
  if (raw.byteLength !== 64) throw new Error("expected 64B raw r||s");
  const r = trimLeadingZeros(raw.slice(0, 32));
  const s = trimLeadingZeros(raw.slice(32, 64));
  const rBytes = encodeInteger(r);
  const sBytes = encodeInteger(s);
  const seqLen = rBytes.length + sBytes.length;
  const out = new Uint8Array(2 + seqLen);
  out[0] = 0x30;
  out[1] = seqLen;
  out.set(rBytes, 2);
  out.set(sBytes, 2 + rBytes.length);
  return out;
}

function trimLeadingZeros(b: Uint8Array): Uint8Array {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0x00) i++;
  return b.slice(i);
}

function encodeInteger(b: Uint8Array): Uint8Array {
  // ASN.1 INTEGER: prepend 0x00 if high bit set so it stays positive.
  const needsPad = (b[0] ?? 0) & 0x80;
  const inner = needsPad ? new Uint8Array([0x00, ...b]) : b;
  const out = new Uint8Array(2 + inner.length);
  out[0] = 0x02;
  out[1] = inner.length;
  out.set(inner, 2);
  return out;
}

async function signCanonical(
  privateKey: webcrypto.CryptoKey,
  message: Uint8Array,
): Promise<Uint8Array> {
  const raw = new Uint8Array(
    await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, message),
  );
  return rawSigToDer(raw);
}

describe("attest", () => {
  it("makeChallenge produces an RFC-3339 timestamp with seconds precision", () => {
    const c = makeChallenge();
    expect(c.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(c.nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it("signed payload is sorted by key and uses camelCase", () => {
    const resp: AttestationResponse = {
      nonce: "abc",
      timestamp: "2026-05-08T00:00:00Z",
      sip_enabled: true,
      hypervisor_present: false,
      signature: [],
    };
    const bytes = signedPayloadFor(resp);
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe(
      canonicalize({
        hypervisorPresent: false,
        nonce: "abc",
        sipEnabled: true,
        timestamp: "2026-05-08T00:00:00Z",
      }),
    );
    expect(text).toContain('"sipEnabled"');
    expect(text).toContain('"hypervisorPresent"');
    expect(text).not.toContain("sip_enabled");
  });

  it("signed payload omits hypervisorPresent when not provided", () => {
    const resp: AttestationResponse = {
      nonce: "x",
      timestamp: "2026-05-08T00:00:00Z",
      sip_enabled: true,
      signature: [],
    };
    const text = new TextDecoder().decode(signedPayloadFor(resp));
    expect(text).not.toContain("hypervisorPresent");
  });

  it("isFresh rejects nonce mismatch, timestamp mismatch, and large skew", () => {
    const challenge: AttestationChallenge = {
      nonce: "n",
      timestamp: "2026-05-08T00:00:00Z",
    };
    const goodNow = Date.parse("2026-05-08T00:00:30Z");
    expect(isFresh(challenge, { ...challenge, sip_enabled: true, signature: [] }, goodNow)).toBe(
      true,
    );
    expect(
      isFresh(
        challenge,
        { nonce: "other", timestamp: challenge.timestamp, sip_enabled: true, signature: [] },
        goodNow,
      ),
    ).toBe(false);
    expect(
      isFresh(
        challenge,
        {
          nonce: challenge.nonce,
          timestamp: "2026-05-08T00:00:01Z",
          sip_enabled: true,
          signature: [],
        },
        goodNow,
      ),
    ).toBe(false);
    const tooLate = Date.parse("2026-05-08T01:00:00Z");
    expect(isFresh(challenge, { ...challenge, sip_enabled: true, signature: [] }, tooLate)).toBe(
      false,
    );
  });

  it("verifyAttestation accepts a valid round-trip signature", async () => {
    const { privateKey, publicKeyB64 } = await generateKeyPair();
    const challenge = makeChallenge();
    const message = signedPayloadFor({
      nonce: challenge.nonce,
      timestamp: challenge.timestamp,
      sip_enabled: true,
      signature: [],
    });
    const sig = await signCanonical(privateKey, message);
    const resp: AttestationResponse = {
      nonce: challenge.nonce,
      timestamp: challenge.timestamp,
      sip_enabled: true,
      signature: [...sig],
    };
    expect(await verifyAttestation(resp, publicKeyB64)).toBe(true);
  });

  it("verifyAttestation rejects a tampered signed payload", async () => {
    const { privateKey, publicKeyB64 } = await generateKeyPair();
    const challenge = makeChallenge();
    const message = signedPayloadFor({
      nonce: challenge.nonce,
      timestamp: challenge.timestamp,
      sip_enabled: true,
      signature: [],
    });
    const sig = await signCanonical(privateKey, message);
    // Flip sip_enabled in the response — signature was over true.
    const resp: AttestationResponse = {
      nonce: challenge.nonce,
      timestamp: challenge.timestamp,
      sip_enabled: false,
      signature: [...sig],
    };
    expect(await verifyAttestation(resp, publicKeyB64)).toBe(false);
  });

  it("verifyAttestation accepts signature both as number[] and base64 string", async () => {
    const { privateKey, publicKeyB64 } = await generateKeyPair();
    const challenge = makeChallenge();
    const message = signedPayloadFor({
      nonce: challenge.nonce,
      timestamp: challenge.timestamp,
      sip_enabled: true,
      signature: [],
    });
    const sig = await signCanonical(privateKey, message);
    const sigB64 = bytesToBase64(sig);
    const respArr: AttestationResponse = {
      nonce: challenge.nonce,
      timestamp: challenge.timestamp,
      sip_enabled: true,
      signature: [...sig],
    };
    const respStr: AttestationResponse = { ...respArr, signature: sigB64 };
    expect(await verifyAttestation(respArr, publicKeyB64)).toBe(true);
    expect(await verifyAttestation(respStr, publicKeyB64)).toBe(true);
  });
});
