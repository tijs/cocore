// AppView PDS-write endpoints.
//
// Internal HTTP RPCs (NOT XRPC/lexicon methods) that write ATProto
// records to a user's PDS via a DPoP-bound OAuth session the AppView
// owns. Two auth modes share the exact same write core:
//
//   * /pds/{create,put,delete}Record — bearer API key (cocore-...). The
//     key resolves to a DID against the AppView's AccountStore. Used by
//     callers that hold an AppView-minted key directly.
//
//   * /internal/pds/{create,put,delete}Record — internal shared secret +
//     an asserted `did` in the body. Used by the console, which resolves
//     its own bearer key -> DID and forwards the write here so the
//     OAuth/DPoP session work (and its single-writer refresh) lives only
//     in the AppView. This is how existing console-minted keys keep
//     working with zero customer churn: the console stays the key store,
//     the AppView owns the write. /internal/* is private-network only.
//
// Only `dev.cocore.*` collections are writable.

import type { Did } from "@atcute/lexicons";
import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";

import type { AccountStore } from "../operational/account-store.ts";
import {
  type AppviewOAuthClient,
  type RestoredSession,
  restoreSession,
} from "../auth/oauth-client.ts";

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => void | Promise<void>;

const COLLECTION_PREFIX = "dev.cocore.";

export interface PdsWriteContext {
  accounts: AccountStore;
  oauth: AppviewOAuthClient;
  /** Bridge base URL for the best-effort AppView-cache mirror. When unset,
   *  writes still land on the PDS and the firehose catches up. */
  bridgeUrl?: string;
}

// ---- small helpers --------------------------------------------------

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers["authorization"];
  if (typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1]!.trim() : null;
}

function secretEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 5 * 1024 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (raw.length === 0) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("body must be JSON"));
      }
    });
    req.on("error", reject);
  });
}

function rkeyFromUri(uri: string): string {
  const parts = uri.split("/");
  return parts[parts.length - 1] ?? "";
}

function mirrorPublish(
  bridgeUrl: string | undefined,
  args: {
    uri: string;
    cid: string;
    collection: string;
    repo: string;
    record: Record<string, unknown>;
  },
): void {
  if (!bridgeUrl) return;
  void fetch(`${bridgeUrl.replace(/\/$/, "")}/xrpc/dev.cocore.bridge.publish`, {
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

function mirrorUnpublish(bridgeUrl: string | undefined, uri: string): void {
  if (!bridgeUrl) return;
  void fetch(`${bridgeUrl.replace(/\/$/, "")}/xrpc/dev.cocore.bridge.unpublish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uri }),
  }).catch(() => {
    /* swallowed — firehose catches up */
  });
}

function isAllowedCollection(c: unknown): c is string {
  return typeof c === "string" && c.startsWith(COLLECTION_PREFIX);
}

// ---- body validation (shared by both auth modes) --------------------

interface CreateArgs {
  collection: string;
  record: Record<string, unknown>;
  rkey?: string;
}
interface PutArgs {
  collection: string;
  rkey: string;
  record: Record<string, unknown>;
  swapRecord?: string;
}
interface DeleteArgs {
  collection: string;
  rkey: string;
  swapRecord?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseCreate(b: Record<string, unknown>): CreateArgs | string {
  if (!isAllowedCollection(b.collection)) return `collection must start with ${COLLECTION_PREFIX}`;
  if (!isRecord(b.record)) return "record must be a non-null object";
  if (b.rkey !== undefined && typeof b.rkey !== "string")
    return "rkey must be a string when provided";
  return {
    collection: b.collection,
    record: b.record,
    ...(typeof b.rkey === "string" ? { rkey: b.rkey } : {}),
  };
}

function parsePut(b: Record<string, unknown>): PutArgs | string {
  if (!isAllowedCollection(b.collection)) return `collection must start with ${COLLECTION_PREFIX}`;
  if (typeof b.rkey !== "string" || b.rkey.length === 0)
    return "rkey required (use createRecord for fresh rkeys)";
  if (!isRecord(b.record)) return "record must be a non-null object";
  if (b.swapRecord !== undefined && typeof b.swapRecord !== "string")
    return "swapRecord must be a string when provided";
  return {
    collection: b.collection,
    rkey: b.rkey,
    record: b.record,
    ...(typeof b.swapRecord === "string" ? { swapRecord: b.swapRecord } : {}),
  };
}

function parseDelete(b: Record<string, unknown>): DeleteArgs | string {
  if (!isAllowedCollection(b.collection)) return `collection must start with ${COLLECTION_PREFIX}`;
  if (typeof b.rkey !== "string" || b.rkey.length === 0) return "rkey required";
  if (b.swapRecord !== undefined && typeof b.swapRecord !== "string")
    return "swapRecord must be a string when provided";
  return {
    collection: b.collection,
    rkey: b.rkey,
    ...(typeof b.swapRecord === "string" ? { swapRecord: b.swapRecord } : {}),
  };
}

// ---- write cores (given an authenticated DID + session) -------------

async function doCreate(
  res: ServerResponse,
  ctx: PdsWriteContext,
  did: string,
  session: RestoredSession,
  a: CreateArgs,
): Promise<void> {
  const r = await session.handle(`/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repo: did,
      collection: a.collection,
      record: a.record,
      ...(a.rkey ? { rkey: a.rkey } : {}),
    }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return json(res, r.status >= 500 ? 502 : r.status, {
      error: "PdsError",
      message: `createRecord ${a.collection}: ${text.slice(0, 300)}`,
    });
  }
  const out = (await r.json()) as {
    uri: string;
    cid: string;
    commit?: { cid: string; rev: string };
  };
  mirrorPublish(ctx.bridgeUrl, {
    uri: out.uri,
    cid: out.cid,
    collection: a.collection,
    repo: did,
    record: a.record,
  });
  json(res, 200, { uri: out.uri, cid: out.cid, commit: out.commit });
}

async function doPut(
  res: ServerResponse,
  ctx: PdsWriteContext,
  did: string,
  session: RestoredSession,
  a: PutArgs,
): Promise<void> {
  const r = await session.handle(`/xrpc/com.atproto.repo.putRecord`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repo: did,
      collection: a.collection,
      rkey: a.rkey,
      record: a.record,
      ...(a.swapRecord ? { swapRecord: a.swapRecord } : {}),
    }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return json(res, r.status >= 500 ? 502 : r.status, {
      error: "PdsError",
      message: `putRecord ${a.collection}: ${text.slice(0, 300)}`,
    });
  }
  const out = (await r.json()) as { uri: string; cid: string };
  mirrorPublish(ctx.bridgeUrl, {
    uri: out.uri,
    cid: out.cid,
    collection: a.collection,
    repo: did,
    record: a.record,
  });
  json(res, 200, { uri: out.uri, cid: out.cid });
}

async function doDelete(
  res: ServerResponse,
  ctx: PdsWriteContext,
  did: string,
  session: RestoredSession,
  a: DeleteArgs,
): Promise<void> {
  const uri = `at://${did}/${a.collection}/${a.rkey}`;
  const r = await session.handle(`/xrpc/com.atproto.repo.deleteRecord`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repo: did,
      collection: a.collection,
      rkey: a.rkey,
      ...(a.swapRecord ? { swapRecord: a.swapRecord } : {}),
    }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    // Already-gone collapses to success so the agent's dedup loop moves on.
    if (r.status === 404 || /not.*locate|InvalidSwap|not.*found/i.test(text)) {
      mirrorUnpublish(ctx.bridgeUrl, uri);
      return json(res, 200, { uri, alreadyGone: true });
    }
    return json(res, r.status >= 500 ? 502 : r.status, {
      error: "PdsError",
      message: `deleteRecord ${a.collection}: ${text.slice(0, 300)}`,
    });
  }
  mirrorUnpublish(ctx.bridgeUrl, uri);
  json(res, 200, { uri });
}

// ---- auth + body plumbing -------------------------------------------

/** Read + JSON-parse the body, writing a 400 and returning null on failure. */
async function body(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | null> {
  try {
    return (await readJsonBody(req)) as Record<string, unknown>;
  } catch (e) {
    json(res, 400, { error: "InvalidRequest", message: (e as Error).message });
    return null;
  }
}

/** Restore the session for `did`, or write the 401 and return null. */
async function sessionFor(
  res: ServerResponse,
  ctx: PdsWriteContext,
  did: string,
): Promise<RestoredSession | null> {
  const session = await restoreSession(ctx.oauth, did as Did);
  if (!session) {
    json(res, 401, {
      error: "AuthRequired",
      message: "underlying ATProto session no longer valid; re-authenticate",
    });
    return null;
  }
  return session;
}

/** Bearer-key auth: resolve the cocore-... key to a DID + session. */
async function bearerAuth(req: IncomingMessage, res: ServerResponse, ctx: PdsWriteContext) {
  const token = bearer(req);
  if (!token) {
    json(res, 401, { error: "AuthRequired", message: "missing Authorization: Bearer header" });
    return null;
  }
  const resolved = ctx.accounts.resolveBearerKey(token);
  if (!resolved) {
    json(res, 401, { error: "AuthRequired", message: "invalid API key" });
    return null;
  }
  const session = await sessionFor(res, ctx, resolved.did);
  if (!session) return null;
  return { did: resolved.did, session };
}

function post(handler: Handler): Handler {
  return (req, res, url) => {
    if (req.method !== "POST") {
      json(res, 405, { error: "MethodNotAllowed" });
      return;
    }
    return handler(req, res, url);
  };
}

// ---- route factories ------------------------------------------------

/** Public, bearer-key-authed `/pds/*` write endpoints. */
export function pdsRoutes(ctx: PdsWriteContext): Record<string, Handler> {
  return {
    "/pds/createRecord": post(async (req, res) => {
      const auth = await bearerAuth(req, res, ctx);
      if (!auth) return;
      const b = await body(req, res);
      if (!b) return;
      const a = parseCreate(b);
      if (typeof a === "string") return json(res, 400, { error: "InvalidRequest", message: a });
      await doCreate(res, ctx, auth.did, auth.session, a);
    }),
    "/pds/putRecord": post(async (req, res) => {
      const auth = await bearerAuth(req, res, ctx);
      if (!auth) return;
      const b = await body(req, res);
      if (!b) return;
      const a = parsePut(b);
      if (typeof a === "string") return json(res, 400, { error: "InvalidRequest", message: a });
      await doPut(res, ctx, auth.did, auth.session, a);
    }),
    "/pds/deleteRecord": post(async (req, res) => {
      const auth = await bearerAuth(req, res, ctx);
      if (!auth) return;
      const b = await body(req, res);
      if (!b) return;
      const a = parseDelete(b);
      if (typeof a === "string") return json(res, 400, { error: "InvalidRequest", message: a });
      await doDelete(res, ctx, auth.did, auth.session, a);
    }),
  };
}

/** Private, internal-secret-authed `/internal/pds/*` write endpoints. The
 *  caller (the console) asserts the record's owning `did` in the body
 *  after resolving its own bearer key. Only served on the private :8081
 *  listener. */
export function internalPdsRoutes(ctx: PdsWriteContext, secret: string): Record<string, Handler> {
  const auth = (req: IncomingMessage, res: ServerResponse): string | null => {
    const presented = req.headers["x-cocore-internal-secret"];
    if (typeof presented !== "string" || !secretEquals(presented, secret)) {
      json(res, 403, { error: "Forbidden" });
      return null;
    }
    return "ok";
  };
  const did = (b: Record<string, unknown>, res: ServerResponse): string | null => {
    if (typeof b.did !== "string" || !b.did.startsWith("did:")) {
      json(res, 400, { error: "InvalidRequest", message: "did required" });
      return null;
    }
    return b.did;
  };
  return {
    "/internal/pds/createRecord": post(async (req, res) => {
      if (!auth(req, res)) return;
      const b = await body(req, res);
      if (!b) return;
      const d = did(b, res);
      if (!d) return;
      const a = parseCreate(b);
      if (typeof a === "string") return json(res, 400, { error: "InvalidRequest", message: a });
      const session = await sessionFor(res, ctx, d);
      if (!session) return;
      await doCreate(res, ctx, d, session, a);
    }),
    "/internal/pds/putRecord": post(async (req, res) => {
      if (!auth(req, res)) return;
      const b = await body(req, res);
      if (!b) return;
      const d = did(b, res);
      if (!d) return;
      const a = parsePut(b);
      if (typeof a === "string") return json(res, 400, { error: "InvalidRequest", message: a });
      const session = await sessionFor(res, ctx, d);
      if (!session) return;
      await doPut(res, ctx, d, session, a);
    }),
    "/internal/pds/deleteRecord": post(async (req, res) => {
      if (!auth(req, res)) return;
      const b = await body(req, res);
      if (!b) return;
      const d = did(b, res);
      if (!d) return;
      const a = parseDelete(b);
      if (typeof a === "string") return json(res, 400, { error: "InvalidRequest", message: a });
      const session = await sessionFor(res, ctx, d);
      if (!session) return;
      await doDelete(res, ctx, d, session, a);
    }),
  };
}
