// Durable store for captured Apple x5c attestation chains (Secure Mode /
// MDA), keyed by device serial. Backed by the same SQLite DB as the rest
// of console-owned state (console-db.server.ts), so chains survive a
// console redeploy as long as the Railway volume is attached.
//
// SECURITY: we persist ONLY the public x5c chain (base64 DER certs). No
// private key, no SCEP secret, no PKCS12 ever reaches this table — the
// device's keys are SEP-resident and never leave the Mac.

import { consoleDb } from "@/lib/console-db.server.ts";

/** Persist (or replace) the captured Apple attestation chain for a serial.
 *  `chain` is leaf-first base64 DER certs (att.mdaCertChain shape). */
export function putAttestationChain(serial: string, chain: string[], capturedAt: string): void {
  consoleDb()
    .prepare(
      `INSERT INTO mdm_attestation_chains (serial, chain_json, captured_at)
       VALUES (?, ?, ?)
       ON CONFLICT(serial) DO UPDATE SET
         chain_json = excluded.chain_json,
         captured_at = excluded.captured_at`,
    )
    .run(serial, JSON.stringify(chain), capturedAt);
}

/** Return the captured chain for a serial, or null when none is stored. */
export function getAttestationChain(
  serial: string,
): { chain: string[]; capturedAt: string } | null {
  const row = consoleDb()
    .prepare(`SELECT chain_json, captured_at FROM mdm_attestation_chains WHERE serial = ?`)
    .get(serial) as { chain_json: string; captured_at: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.chain_json) as unknown;
    if (Array.isArray(parsed) && parsed.every((c) => typeof c === "string")) {
      return { chain: parsed as string[], capturedAt: row.captured_at };
    }
  } catch {
    /* fall through to null on a corrupt row */
  }
  return null;
}
