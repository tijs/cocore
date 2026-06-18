import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APPLE_ENTERPRISE_ATTESTATION_ROOT_CA_PEM, MdaError, verifyChainAgainst } from "./mda.ts";

function loadFixture(): {
  rootDerB64: string;
  chainDerB64: string[];
  appleRootPem: string;
  expected: {
    valid: boolean;
    deviceSerial: string;
    deviceUdid: string;
    sipEnabled: boolean;
  };
} {
  const here = new URL(".", import.meta.url).pathname;
  const path = join(here, "..", "..", "..", "target", "mda-cross-lang-fixture.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

function b64(s: string): Uint8Array {
  return Uint8Array.from(Buffer.from(s, "base64"));
}

test("cross-language MDA fixture: TS verifies a chain produced by Rust", () => {
  const f = loadFixture();
  const chain = f.chainDerB64.map(b64);
  const root = b64(f.rootDerB64);
  const result = verifyChainAgainst(chain, root, new Date());

  assert.equal(result.valid, true);
  assert.equal(result.deviceSerial, f.expected.deviceSerial);
  assert.equal(result.deviceUdid, f.expected.deviceUdid);
  assert.equal(result.sipEnabled, f.expected.sipEnabled);
  // The leaf's P-256 key is extracted as base64 of the raw 64-byte X‖Y
  // point — the encoding a caller compares against attestation.publicKey
  // to BIND the chain to the signer. (Same shape; value is the fixture's
  // random leaf key, so we assert the encoding, not a specific value.)
  assert.ok(result.leafPublicKey, "leafPublicKey should be extracted");
  assert.equal(Buffer.from(result.leafPublicKey!, "base64").length, 64);
});

test("synthetic chain rejected against real Apple root", () => {
  const f = loadFixture();
  const chain = f.chainDerB64.map(b64);
  // Pull the Apple PEM from the fixture so this test exercises the
  // exact bytes the Rust side embeds, not a TS-side copy.
  const appleRoot = pemToDer(f.appleRootPem);
  assert.throws(
    () => verifyChainAgainst(chain, appleRoot, new Date()),
    (e: unknown) => e instanceof MdaError && e.code === "bad-signature",
  );
});

test("embedded Apple root PEM is byte-identical to the Rust embed", () => {
  const f = loadFixture();
  // The fixture's appleRootPem comes straight from the Rust constant;
  // a mismatch here means one side has drifted.
  assert.equal(APPLE_ENTERPRISE_ATTESTATION_ROOT_CA_PEM, f.appleRootPem);
});

test("empty chain throws", () => {
  assert.throws(
    () => verifyChainAgainst([], new Uint8Array([0x30]), new Date()),
    (e: unknown) => e instanceof MdaError && e.code === "empty-chain",
  );
});

test("cert outside validity rejected", () => {
  const f = loadFixture();
  const chain = f.chainDerB64.map(b64);
  const root = b64(f.rootDerB64);
  // 100 years in the future — well past the Rust fixture's 2-year window.
  const future = new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000);
  assert.throws(
    () => verifyChainAgainst(chain, root, future),
    (e: unknown) => e instanceof MdaError && e.code === "not-valid",
  );
});

function pemToDer(pem: string): Uint8Array {
  const stripped = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  return Uint8Array.from(Buffer.from(stripped, "base64"));
}
