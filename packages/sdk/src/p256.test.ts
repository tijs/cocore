import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { derToRawSignature, verifyP256, verifyReceiptSignature } from "./p256.ts";
import { canonicalize } from "./canonical.ts";

test("derToRawSignature: 64 bytes for any P-256 sig", () => {
  // A minimal DER sig: SEQUENCE { INTEGER 0x01, INTEGER 0x02 } padded.
  // Build it programmatically.
  const der = new Uint8Array([
    0x30,
    0x06, // SEQUENCE, len 6
    0x02,
    0x01,
    0x01, // INTEGER r = 1
    0x02,
    0x01,
    0x02, // INTEGER s = 2
  ]);
  const raw = derToRawSignature(der);
  assert.equal(raw.length, 64);
  assert.equal(raw[31], 1);
  assert.equal(raw[63], 2);
});

test("derToRawSignature: strips leading zero padding", () => {
  // INTEGER values whose high bit is set get a 0x00 prefix in DER.
  // r = 0x80 (one byte, but DER renders as 0x00 0x80 = two bytes).
  const der = new Uint8Array([
    0x30,
    0x08,
    0x02,
    0x02,
    0x00,
    0x80, // r = 128 (DER: 00 80)
    0x02,
    0x02,
    0x00,
    0x81, // s = 129
  ]);
  const raw = derToRawSignature(der);
  assert.equal(raw[31], 0x80);
  assert.equal(raw[63], 0x81);
});

test("cross-language fixture: TS verifies a signature produced by Rust", async () => {
  // The Rust integration test in
  // provider/tests/cross_lang_fixture.rs writes this JSON. If you
  // run this test from a fresh clone, run `cargo test --test
  // cross_lang_fixture` in provider/ first.
  const path = findFixture();
  const fixture = JSON.parse(readFileSync(path, "utf-8")) as {
    publicKeyB64: string;
    isHardwareBound: boolean;
    canonicalB64: string;
    receipt: Record<string, unknown> & { enclaveSignature: string };
  };

  // 1. Verify directly: bytes Rust signed, signature Rust produced.
  const message = Uint8Array.from(atob(fixture.canonicalB64), (c) => c.charCodeAt(0));
  const ok = await verifyP256(fixture.publicKeyB64, fixture.receipt.enclaveSignature, message);
  assert.equal(ok, true, "TS must verify Rust-produced ECDSA-P256 DER signature");

  // 2. Verify via the higher-level helper that re-canonicalises the
  //    receipt body. Proves canonical-byte parity end-to-end.
  const ok2 = await verifyReceiptSignature(fixture.receipt, fixture.publicKeyB64);
  assert.equal(ok2, true, "verifyReceiptSignature must re-canonicalise to the same bytes");

  // 3. Sanity: the canonical bytes the TS canonicaliser produces from
  //    the receipt body MUST equal the bytes Rust signed.
  const { enclaveSignature: _drop, ...signed } = fixture.receipt;
  const tsCanon = canonicalize(signed);
  const rustCanon = new TextDecoder().decode(message);
  assert.equal(tsCanon, rustCanon, "TS canonicalisation must equal Rust canonicalisation");
});

test("verifyReceiptSignature: tampered body fails", async () => {
  const path = findFixture();
  const fixture = JSON.parse(readFileSync(path, "utf-8"));
  const tampered = { ...fixture.receipt, model: "mistakes-were-made" };
  const ok = await verifyReceiptSignature(tampered, fixture.publicKeyB64);
  assert.equal(ok, false);
});

test("verifyReceiptSignature: missing signature returns false", async () => {
  const ok = await verifyReceiptSignature(
    { foo: "bar" } as unknown as { enclaveSignature: string },
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  );
  assert.equal(ok, false);
});

function findFixture(): string {
  // packages/sdk/src/ → ../../../target/
  const here = new URL(".", import.meta.url).pathname;
  return join(here, "..", "..", "..", "target", "cross-lang-fixture.json");
}
