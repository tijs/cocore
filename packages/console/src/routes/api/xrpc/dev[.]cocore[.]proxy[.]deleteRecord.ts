// POST /api/xrpc/dev.cocore.proxy.deleteRecord
//
// Bearer-key authed deleteRecord proxy. The agent uses this to clean
// up duplicate provider records on its own DID's PDS — when a v0.3.4+
// agent boots and finds N>1 records with the same attestationPubKey
// (its Secure-Enclave fingerprint), it keeps the freshest's rkey and
// deletes the rest through this endpoint. Without it, the only way to
// trim duplicates is the console-side dedupMyProviderRecords helper,
// which requires the user to actively click something.
//
// Same allowlist as proxy.createRecord (`dev.cocore.*` only)
// so a stolen API key can't delete arbitrary records on the user's
// repo.

import type { Did } from "@atcute/lexicons";
import { isDid } from "@atcute/lexicons/syntax";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { restoreAtprotoSessionEffect } from "@/integrations/auth/atproto.server.ts";
import { resolveBearerKey } from "@/lib/api-keys.server.ts";
import { cocoreConfig } from "@/lib/cocore-config.ts";

function mirrorDeleteToBridge(uri: string): void {
  const bridgeUrl = cocoreConfig().bridgeUrl?.replace(/\/$/, "");
  if (!bridgeUrl) return;
  void fetch(`${bridgeUrl}/xrpc/dev.cocore.bridge.unpublish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uri }),
  }).catch(() => {
    /* swallowed — AppView eventually catches up via firehose */
  });
}

interface RawBody {
  collection?: unknown;
  rkey?: unknown;
  swapRecord?: unknown;
}

interface ParsedBody {
  collection: string;
  rkey: string;
  swapRecord?: string;
}

// See proxy.createRecord for the rationale.
const COLLECTION_PREFIX = "dev.cocore.";

function parseBody(raw: RawBody): ParsedBody | string {
  if (typeof raw.collection !== "string" || raw.collection.length === 0) {
    return "collection required";
  }
  if (!raw.collection.startsWith(COLLECTION_PREFIX)) {
    return `collection must start with ${COLLECTION_PREFIX}`;
  }
  if (typeof raw.rkey !== "string" || raw.rkey.length === 0) return "rkey required";
  if (raw.swapRecord !== undefined && typeof raw.swapRecord !== "string") {
    return "swapRecord must be a string when provided";
  }
  return {
    collection: raw.collection,
    rkey: raw.rkey,
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

export const Route = createFileRoute("/api/xrpc/dev.cocore.proxy.deleteRecord")({
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

        const r = await session.handle(`/xrpc/com.atproto.repo.deleteRecord`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            repo: resolved.did,
            collection: parsed.collection,
            rkey: parsed.rkey,
            ...(parsed.swapRecord ? { swapRecord: parsed.swapRecord } : {}),
          }),
        });
        // Mirror deletion regardless of PDS outcome: a record that's
        // already gone from PDS is still expected to disappear from
        // the AppView (the goal is "this row vanishes from /machines").
        const uri = `at://${resolved.did}/${parsed.collection}/${parsed.rkey}`;
        if (!r.ok) {
          const body = await r.text().catch(() => "");
          // 404 / "InvalidSwap" / "could not locate" all collapse to
          // "the record is already gone" — clear the AppView and
          // return success so the agent's dedup loop can move on.
          if (r.status === 404 || /not.*locate|InvalidSwap|not.*found/i.test(body)) {
            mirrorDeleteToBridge(uri);
            return new Response(JSON.stringify({ uri, alreadyGone: true }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          return jsonError(
            r.status >= 500 ? 502 : r.status,
            `pds deleteRecord ${parsed.collection}: ${body.slice(0, 300)}`,
          );
        }
        mirrorDeleteToBridge(uri);
        return new Response(JSON.stringify({ uri }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
