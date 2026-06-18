// ES256 signing for console-published records.
//
// Today the console publishes three signable record types:
//   * dev.cocore.compute.dispute (open + resolve)
//   * dev.cocore.compute.settlement (refund settlements from
//     /api/internal/disputes/resolve)
// (Settlements published by the exchange process via the
// console-proxy createRecord path are signed by the exchange before
// hitting the console — they're outside this module's scope.)
//
// The signing key lives in COCORE_EXCHANGE_PRIVATE_KEY_JWK, the
// same env var the exchange package's signing.ts reads. When the
// var is unset, signRecordIfConfigured() returns null and callers
// publish unsigned. Verifiers see the missing `sig` field and
// classify the record as v0.3.x-unsigned per the lexicon
// description; trust-tier=hardware-attested deployments require
// the var to be set.
//
// The actual sign+canonicalize is identical to what the exchange
// runs — a copy here, with a TODO to extract both into
// `@cocore/sdk/signing` once the public API surface stabilizes.

import { webcrypto } from "node:crypto";

import { canonicalBytes } from "@cocore/sdk/canonical";

const { subtle } = webcrypto;

interface PrivateJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  d: string;
  alg?: "ES256";
  kid?: string;
}

let cached: { jwk: PrivateJwk } | null | undefined;

/** Read + parse COCORE_EXCHANGE_PRIVATE_KEY_JWK once per process.
 *  Returns null when the var is unset OR the value isn't a valid
 *  P-256 private JWK. We log the parse failure once at first call
 *  so misconfigured deploys notice without spamming the log on
 *  every record publish. */
function loadSigningKey(): PrivateJwk | null {
  if (cached !== undefined) return cached?.jwk ?? null;
  const raw = process.env["COCORE_EXCHANGE_PRIVATE_KEY_JWK"];
  if (!raw) {
    cached = null;
    return null;
  }
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (
      v.kty !== "EC" ||
      v.crv !== "P-256" ||
      typeof v.x !== "string" ||
      typeof v.y !== "string" ||
      typeof v.d !== "string"
    ) {
      console.warn(
        "[signing] COCORE_EXCHANGE_PRIVATE_KEY_JWK is set but not a valid EC P-256 private JWK — records will publish unsigned",
      );
      cached = null;
      return null;
    }
    cached = { jwk: v as unknown as PrivateJwk };
    return cached.jwk;
  } catch (e) {
    console.warn(
      `[signing] COCORE_EXCHANGE_PRIVATE_KEY_JWK is set but failed to parse as JSON (${(e as Error).message}) — records will publish unsigned`,
    );
    cached = null;
    return null;
  }
}

function base64urlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** ES256 signature (raw R||S, 64 bytes) over the canonical bytes
 *  of `record` MINUS its `sig` field. Returns base64url with no
 *  padding. Returns null when no signing key is configured —
 *  callers should publish the record unsigned in that case
 *  (production deployments with KMS keys MUST configure
 *  COCORE_EXCHANGE_PRIVATE_KEY_JWK; dev/test deploys are fine
 *  unsigned). */
export async function signRecordIfConfigured(
  record: Record<string, unknown> & { sig?: string },
): Promise<string | null> {
  const priv = loadSigningKey();
  if (!priv) return null;
  const { sig: _drop, ...rest } = record;
  void _drop;
  const bytes = canonicalBytes(rest);
  const key = await subtle.importKey("jwk", priv, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
  const sigBuf = await subtle.sign({ name: "ECDSA", hash: { name: "SHA-256" } }, key, bytes);
  return base64urlEncode(sigBuf);
}

/** Test affordance: drop the cached key so the next call re-reads
 *  process.env. Vitest tests that mutate the env var rely on this. */
export function _resetSigningKeyCache(): void {
  cached = undefined;
}
