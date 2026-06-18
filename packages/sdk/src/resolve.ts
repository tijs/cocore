// Resolve an at-uri to an IndexedRecord by fetching from the
// DID-owner's PDS over HTTPS. Used by the exchange's onReceipt path
// (M5+) to look up job + paymentAuthorization + attestation records
// referenced by an inbound receipt without needing a local cache.
//
// Two-step:
//
//   1. Parse the at-uri (`at://<did>/<collection>/<rkey>`); extract
//      `did`, `collection`, `rkey`.
//   2. Resolve the DID to a PDS endpoint:
//        * did:plc — GET https://plc.directory/<did> and read
//          service[type=AtprotoPersonalDataServer].serviceEndpoint.
//        * did:web — GET https://<host>/.well-known/did.json (or
//          https://<host>/<rest>/did.json for path-form did:webs)
//          and read the same service entry. Falls back to
//          `https://<host>` itself when no service entry is found
//          (some did:web docs omit the AtprotoPDS service).
//   3. GET <pds>/xrpc/com.atproto.repo.getRecord?repo=<did>&collection=<collection>&rkey=<rkey>
//      and pack the result into an IndexedRecord.
//
// The resolution + getRecord round-trips can each be cached at the
// caller's discretion. v1 doesn't cache — every resolve hits the
// network — to keep this module pure. The exchange's wire layer
// will wrap it with an LRU before production volume warrants.

import type { IndexedRecord } from "./types.ts";

export class ResolveError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ResolveError";
  }
}

interface DidDoc {
  service?: Array<{ id?: string; type?: string; serviceEndpoint?: string }>;
}

interface GetRecordResponse {
  uri?: string;
  cid?: string;
  value?: unknown;
}

/** Parse an at-uri into its components. Throws ResolveError when
 *  malformed. Exported so callers can route differently per
 *  collection (e.g. only resolve receipts, skip the rest). */
export function parseAtUri(uri: string): { did: string; collection: string; rkey: string } {
  if (!uri.startsWith("at://")) {
    throw new ResolveError("bad-at-uri", `not an at-uri: ${uri}`);
  }
  const rest = uri.slice("at://".length);
  const parts = rest.split("/");
  if (parts.length < 3) {
    throw new ResolveError("bad-at-uri", `at-uri missing collection or rkey: ${uri}`);
  }
  const [did, collection, rkey] = parts;
  if (!did || !collection || !rkey) {
    throw new ResolveError("bad-at-uri", `at-uri has empty segment(s): ${uri}`);
  }
  if (!did.startsWith("did:")) {
    throw new ResolveError("bad-at-uri", `at-uri repo is not a DID: ${did}`);
  }
  return { did, collection, rkey };
}

function endpointFromDoc(doc: DidDoc): string | null {
  const svc = (doc.service ?? []).find(
    (s) => s.type === "AtprotoPersonalDataServer" && typeof s.serviceEndpoint === "string",
  );
  return svc?.serviceEndpoint?.replace(/\/$/, "") ?? null;
}

/** Resolve a DID to its PDS endpoint URL. Returns null when no
 *  AtprotoPersonalDataServer service entry is published. Network
 *  failures throw ResolveError. */
export async function resolvePdsEndpoint(
  did: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (did.startsWith("did:plc:")) {
    const r = await fetchImpl(`https://plc.directory/${encodeURIComponent(did)}`);
    if (r.status === 404) return null;
    if (!r.ok) {
      throw new ResolveError("plc-fetch", `plc.directory ${r.status} for ${did}`);
    }
    const doc = (await r.json()) as DidDoc;
    return endpointFromDoc(doc);
  }
  if (did.startsWith("did:web:")) {
    // did:web:host[:path:segments] -> host with %3A-encoded port +
    // optional path. Per spec the well-known is at
    // https://<host>[/path]/.well-known/did.json (root) OR
    // https://<host>/<path>/did.json (path form). We try the
    // root form first; for path-form did:webs that fails 404 and
    // we fall through.
    const tail = did.slice("did:web:".length);
    const segments = tail.split(":").map((s) => decodeURIComponent(s));
    const host = segments[0]!;
    const path = segments.slice(1).join("/");
    const url = path ? `https://${host}/${path}/did.json` : `https://${host}/.well-known/did.json`;
    const r = await fetchImpl(url);
    if (r.status === 404) return null;
    if (!r.ok) {
      throw new ResolveError("did-web-fetch", `${url} returned ${r.status}`);
    }
    const doc = (await r.json()) as DidDoc;
    return endpointFromDoc(doc);
  }
  throw new ResolveError("unsupported-did", `unsupported DID method: ${did}`);
}

export interface ResolveRecordOptions {
  fetchImpl?: typeof fetch;
  /** Override PDS endpoint resolution — useful when the caller
   *  already knows where the record lives. */
  pdsEndpoint?: string;
}

/** Fetch the record at `uri` from the owner's PDS and return it as
 *  an IndexedRecord. Returns null when:
 *    * the DID has no published AtprotoPDS service entry
 *    * the PDS getRecord returns 404 (record doesn't exist yet)
 *
 *  Throws ResolveError for everything else (network, malformed
 *  doc, malformed uri). The exchange's onReceipt treats null as
 *  "skip this receipt for now and retry on a future receipt
 *  observation"; ResolveError is fatal for the call. */
export async function resolveRecordOverPds(
  uri: string,
  opts: ResolveRecordOptions = {},
): Promise<IndexedRecord | null> {
  const { did, collection, rkey } = parseAtUri(uri);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const endpoint =
    opts.pdsEndpoint?.replace(/\/$/, "") ?? (await resolvePdsEndpoint(did, fetchImpl));
  if (!endpoint) return null;
  const params = new URLSearchParams({ repo: did, collection, rkey });
  const r = await fetchImpl(`${endpoint}/xrpc/com.atproto.repo.getRecord?${params}`);
  if (r.status === 404) return null;
  if (!r.ok) {
    throw new ResolveError("get-record", `getRecord ${r.status} for ${uri}`);
  }
  const body = (await r.json()) as GetRecordResponse;
  if (!body.uri || !body.cid || !body.value) {
    throw new ResolveError("malformed-get-record", `PDS returned no uri/cid/value for ${uri}`);
  }
  return {
    uri: body.uri,
    cid: body.cid,
    collection,
    repo: did,
    rkey,
    body: body.value,
  };
}
