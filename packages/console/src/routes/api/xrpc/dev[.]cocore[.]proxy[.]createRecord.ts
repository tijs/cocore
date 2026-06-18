// POST /api/xrpc/dev.cocore.proxy.createRecord
//
// Bearer-key authed proxy that creates an ATProto record on the
// caller's PDS via the console's OAuth session. Used by the Rust
// provider agent to publish attestation, provider, and receipt
// records — the agent can't talk to bsky directly because real bsky
// PDSes require DPoP-bound tokens, and the JS OAuth client running
// in the console is the thing that actually has DPoP wired up.
//
// Auth flow:
//   1. Caller presents `Authorization: Bearer cocore-...`
//   2. Resolve key → DID
//   3. Restore the OAuth session for that DID from SQLite
//   4. Call session.handle() to publish — DPoP is automatic
//   5. Return { uri, cid }
//
// Collection allowlist: only `dev.cocore.compute.*` NSIDs are
// proxied. Lets us guard against a stolen API key being used to
// scribble arbitrary records onto the user's repo.

import type { Did } from "@atcute/lexicons";
import { isDid } from "@atcute/lexicons/syntax";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { restoreAtprotoSessionEffect } from "@/integrations/auth/atproto.server.ts";
import { resolveBearerKey } from "@/lib/api-keys.server.ts";
import { cocoreConfig } from "@/lib/cocore-config.ts";

function rkeyFromUri(uri: string): string {
  const parts = uri.split("/");
  return parts[parts.length - 1] ?? "";
}

/** Best-effort mirror to the local AppView indexer. We don't await
 *  the response — if the bridge is down the PDS record still wins,
 *  and the AppView will eventually catch up via the firehose. */
function mirrorToBridge(args: {
  uri: string;
  cid: string;
  collection: string;
  repo: string;
  record: Record<string, unknown>;
}): void {
  const bridgeUrl = cocoreConfig().bridgeUrl?.replace(/\/$/, "");
  if (!bridgeUrl) return;
  void fetch(`${bridgeUrl}/xrpc/dev.cocore.bridge.publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      uri: args.uri,
      cid: args.cid,
      collection: args.collection,
      repo: args.repo,
      rkey: rkeyFromUri(args.uri),
      body: args.record,
    }),
  }).catch(() => {
    // swallowed — this is a cache hint, not a checkpoint
  });
}

interface RawBody {
  collection?: unknown;
  record?: unknown;
  rkey?: unknown;
}

interface ParsedBody {
  collection: string;
  record: Record<string, unknown>;
  rkey?: string;
}

/** Collection NSIDs this proxy will write to a user's PDS. We allow
 *  the full `dev.cocore.*` namespace (compute.* receipts/jobs/etc.
 *  AND account.* profile/grant/friend/patronage records) because
 *  the services container needs to publish account records too —
 *  see infra/services/src/main.ts's `emitTokenGrantRecord` and
 *  `emitPatronageRecords`. A bearer API key still gates the call,
 *  so the worst this can do is scribble cocore-shaped records onto
 *  the user's repo; never anything outside the namespace. */
const COLLECTION_PREFIX = "dev.cocore.";

function parseBody(raw: RawBody): ParsedBody | string {
  if (typeof raw.collection !== "string" || raw.collection.length === 0) {
    return "collection required";
  }
  if (!raw.collection.startsWith(COLLECTION_PREFIX)) {
    return `collection must start with ${COLLECTION_PREFIX}`;
  }
  if (typeof raw.record !== "object" || raw.record === null || Array.isArray(raw.record)) {
    return "record must be a non-null object";
  }
  if (raw.rkey !== undefined && typeof raw.rkey !== "string") {
    return "rkey must be a string when provided";
  }
  return {
    collection: raw.collection,
    record: raw.record as Record<string, unknown>,
    ...(typeof raw.rkey === "string" ? { rkey: raw.rkey } : {}),
  };
}

function readBearer(request: Request): string | null {
  const h = request.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1]!.trim() : null;
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/xrpc/dev.cocore.proxy.createRecord")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const bearer = readBearer(request);
        if (!bearer) return jsonError(401, "missing Authorization: Bearer header");

        const resolved = resolveBearerKey(bearer);
        if (!resolved) return jsonError(401, "invalid API key");
        if (!isDid(resolved.did)) return jsonError(500, "stored DID is malformed");

        let raw: RawBody;
        try {
          raw = (await request.json()) as RawBody;
        } catch {
          return jsonError(400, "body must be JSON");
        }
        const parsed = parseBody(raw);
        if (typeof parsed === "string") return jsonError(400, parsed);

        const session = await Effect.runPromise(restoreAtprotoSessionEffect(resolved.did as Did));
        if (!session) {
          return jsonError(401, "underlying ATProto session no longer valid; re-authenticate");
        }

        const r = await session.handle(`/xrpc/com.atproto.repo.createRecord`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            repo: resolved.did,
            collection: parsed.collection,
            record: parsed.record,
            ...(parsed.rkey ? { rkey: parsed.rkey } : {}),
          }),
        });
        if (!r.ok) {
          const body = await r.text().catch(() => "");
          return jsonError(
            r.status >= 500 ? 502 : r.status,
            `pds createRecord ${parsed.collection}: ${body.slice(0, 300)}`,
          );
        }
        // com.atproto.repo.createRecord returns `commit: { cid, rev }` —
        // the signed repo commit the record landed in. Forward it so the
        // caller (e.g. the provider, writing a receipt) can surface an
        // inclusion pointer into the provider's signed MST without the
        // verifier having to re-fetch the repo.
        const out = (await r.json()) as {
          uri: string;
          cid: string;
          commit?: { cid: string; rev: string };
        };
        // Mirror to the local AppView indexer so /machines, /jobs,
        // and /models see the record with low latency. The relay
        // subscription (services-container side) is the durable
        // path, but the bridge dispatch shortens the round-trip
        // for records published through this console proxy.
        mirrorToBridge({
          uri: out.uri,
          cid: out.cid,
          collection: parsed.collection,
          repo: resolved.did,
          record: parsed.record,
        });
        return new Response(JSON.stringify({ uri: out.uri, cid: out.cid, commit: out.commit }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
