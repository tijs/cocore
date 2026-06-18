// POST /api/xrpc/dev.cocore.proxy.putRecord
//
// Idempotent-upsert sibling to dev.cocore.proxy.createRecord. Same
// Bearer-key auth, same dev.cocore.compute.* allowlist, same DPoP
// passthrough — but talks to com.atproto.repo.putRecord on the user's
// PDS so the agent can re-publish at a stable rkey without growing
// the on-PDS record set every time `cocore agent serve` boots.
//
// The agent computes the rkey once per (DID, attestationPubKey) pair
// (see provider/src/pds.rs) and reuses it forever after. PDS-side
// putRecord with a `swapRecord` guard ensures concurrent serve
// invocations on the same machine can't trample each other.

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
    /* swallowed — cache hint, not a checkpoint */
  });
}

interface RawBody {
  collection?: unknown;
  rkey?: unknown;
  record?: unknown;
  swapRecord?: unknown;
}

interface ParsedBody {
  collection: string;
  rkey: string;
  record: Record<string, unknown>;
  swapRecord?: string;
}

// Allows the full `dev.cocore.*` namespace — see proxy.createRecord
// for the rationale (account.* records publish through here too).
const COLLECTION_PREFIX = "dev.cocore.";

function parseBody(raw: RawBody): ParsedBody | string {
  if (typeof raw.collection !== "string" || raw.collection.length === 0) {
    return "collection required";
  }
  if (!raw.collection.startsWith(COLLECTION_PREFIX)) {
    return `collection must start with ${COLLECTION_PREFIX}`;
  }
  if (typeof raw.rkey !== "string" || raw.rkey.length === 0) {
    return "rkey required for putRecord (use proxy.createRecord for fresh rkeys)";
  }
  if (typeof raw.record !== "object" || raw.record === null || Array.isArray(raw.record)) {
    return "record must be a non-null object";
  }
  if (raw.swapRecord !== undefined && typeof raw.swapRecord !== "string") {
    return "swapRecord must be a string when provided";
  }
  return {
    collection: raw.collection,
    rkey: raw.rkey,
    record: raw.record as Record<string, unknown>,
    ...(typeof raw.swapRecord === "string" ? { swapRecord: raw.swapRecord } : {}),
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

export const Route = createFileRoute("/api/xrpc/dev.cocore.proxy.putRecord")({
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

        const r = await session.handle(`/xrpc/com.atproto.repo.putRecord`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            repo: resolved.did,
            collection: parsed.collection,
            rkey: parsed.rkey,
            record: parsed.record,
            ...(parsed.swapRecord ? { swapRecord: parsed.swapRecord } : {}),
          }),
        });
        if (!r.ok) {
          const body = await r.text().catch(() => "");
          return jsonError(
            r.status >= 500 ? 502 : r.status,
            `pds putRecord ${parsed.collection}: ${body.slice(0, 300)}`,
          );
        }
        const out = (await r.json()) as { uri: string; cid: string };
        mirrorToBridge({
          uri: out.uri,
          cid: out.cid,
          collection: parsed.collection,
          repo: resolved.did,
          record: parsed.record,
        });
        return new Response(JSON.stringify({ uri: out.uri, cid: out.cid }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
