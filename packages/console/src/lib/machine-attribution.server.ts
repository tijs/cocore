// Resolve which machine served which receipt, so the machines dashboard
// can show real per-box earnings instead of splitting the fleet total
// evenly. A receipt strong-refs the dev.cocore.compute.attestation it was
// signed under; that attestation carries the machine's `publicKey`, which
// equals the provider record's `attestationPubKey`. This module fetches the
// signed-in user's attestation records and maps each attestation URI → its
// publicKey; the dashboard joins receipt → attestation pubkey → provider.

import type { OAuthSession } from "@atcute/oauth-node-client";

interface ListRecordsResponse {
  records?: Array<{ uri: string; value: Record<string, unknown> }>;
  cursor?: string;
}

/** Up to this many pages (×100 records) of attestation history. One
 *  attestation is published per serve session, so a long-lived account
 *  accumulates several; this bound keeps the request cheap while covering
 *  the recent windows the dashboard shows. */
const MAX_PAGES = 10;

/** Map each of the signed-in user's `dev.cocore.compute.attestation`
 *  records to its `publicKey`. Best-effort: returns whatever it gathered
 *  (possibly empty) on any error, and the caller falls back to the even
 *  split when the map can't attribute the receipts. */
export async function fetchAttestationPubkeys(session: OAuthSession): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let cursor: string | undefined;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        repo: session.did,
        collection: "dev.cocore.compute.attestation",
        limit: "100",
      });
      if (cursor) params.set("cursor", cursor);
      const r = await session.handle(`/xrpc/com.atproto.repo.listRecords?${params}`, {
        method: "GET",
      });
      if (!r.ok) break;
      const body = (await r.json()) as ListRecordsResponse;
      const records = body.records ?? [];
      for (const rec of records) {
        const pk = rec.value["publicKey"];
        if (typeof pk === "string" && pk.length > 0) out.set(rec.uri, pk);
      }
      if (!body.cursor || records.length === 0) break;
      cursor = body.cursor;
    }
  } catch {
    return out;
  }
  return out;
}
