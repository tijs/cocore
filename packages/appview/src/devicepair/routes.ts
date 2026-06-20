// Device-pairing XRPC handlers, served by the AppView over the in-memory
// PairStore.
//
//   /xrpc/dev.cocore.devicePair.start    (POST, public)        — agent begins a pairing
//   /xrpc/dev.cocore.devicePair.poll     (GET,  public)        — agent polls for the session
//   /xrpc/dev.cocore.devicePair.confirm  (POST, service-auth)  — user approves/denies
//
// confirm is a real public XRPC method authed via AT Protocol service auth
// (the approving user's PDS proxies the call to `#cocore_appview`). On
// approve the AppView mints a `cocore-...` key scoped to the verified DID,
// builds the ProviderSession, and binds it to the pairing. start/poll are
// agent-facing and need no auth.

import type { IncomingMessage, ServerResponse } from "node:http";

import { verifyServiceAuthToken } from "../auth/service-auth.ts";
import type { AccountStore } from "../operational/account-store.ts";
import { hydrateDids } from "../bsky-hydrate.ts";
import { PairError, type PairStore, type ProviderSession } from "./pair-store.ts";

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => void | Promise<void>;

export interface DevicePairContext {
  /** Mints the scoped API key handed to the paired agent. */
  accountStore: AccountStore;
  /** This AppView's service DID — the `aud` that confirm's service-auth
   *  JWT must target. */
  appviewDid: string;
  /** Base URL the paired agent posts records to (the AppView's own public
   *  origin; the agent appends `/api/pds/createRecord`). */
  apiBase: string;
}

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

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 256 * 1024) {
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

export function devicePairRoutes(
  store: PairStore,
  ctx: DevicePairContext,
): Record<string, Handler> {
  return {
    "/xrpc/dev.cocore.devicePair.start": (req, res) => {
      if (req.method !== "POST") return json(res, 405, { error: "MethodNotAllowed" });
      json(res, 200, store.start());
    },

    "/xrpc/dev.cocore.devicePair.poll": (req, res, url) => {
      if (req.method !== "GET") return json(res, 405, { error: "MethodNotAllowed" });
      const deviceId = url.searchParams.get("deviceId");
      if (!deviceId)
        return json(res, 400, { error: "InvalidRequest", message: "missing deviceId" });
      const r = store.poll(deviceId);
      switch (r.kind) {
        case "unknown":
          return json(res, 404, { status: "unknown" });
        case "pending":
          return json(res, 200, { status: "pending" });
        case "denied":
          return json(res, 403, { status: "denied" });
        case "expired":
          return json(res, 410, { status: "expired" });
        case "consumed":
          return json(res, 410, { status: "consumed" });
        case "session":
          return json(res, 200, { status: "session", session: r.session });
      }
    },

    "/xrpc/dev.cocore.devicePair.confirm": async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { error: "MethodNotAllowed" });
      const auth = await verifyServiceAuthToken(bearer(req), {
        audience: ctx.appviewDid,
        lxm: "dev.cocore.devicePair.confirm",
      });
      if (!auth.ok) return json(res, auth.status, { error: auth.error, message: auth.message });
      const did = auth.did;

      let body: { userCode?: unknown; decision?: unknown };
      try {
        body = (await readJsonBody(req)) as typeof body;
      } catch (e) {
        return json(res, 400, { error: "InvalidRequest", message: (e as Error).message });
      }
      const code = (typeof body.userCode === "string" ? body.userCode : "").trim().toUpperCase();
      if (!code) return json(res, 400, { error: "InvalidRequest", message: "missing userCode" });

      if (body.decision === "deny") {
        try {
          store.deny(code);
        } catch {
          return json(res, 404, { error: "unknown code" });
        }
        return json(res, 200, { ok: true, status: "denied" });
      }
      if (body.decision !== "approve") {
        return json(res, 400, {
          error: "InvalidRequest",
          message: "decision must be approve|deny",
        });
      }

      // Approve: mint a scoped key for the verified DID and bind the
      // ProviderSession to the pairing.
      const hydrated = await hydrateDids([did]).catch(() => new Map());
      const handle = hydrated.get(did)?.handle ?? did;
      const { secret } = ctx.accountStore.createKey({
        did,
        name: `paired machine (${new Date().toISOString().slice(0, 10)})`,
      });
      const session: ProviderSession = { did, handle, apiKey: secret, apiBase: ctx.apiBase };
      try {
        const entry = store.approve(code, session);
        return json(res, 200, { ok: true, status: entry.status });
      } catch (e) {
        if (e instanceof PairError) return json(res, 409, { error: e.message });
        return json(res, 409, { error: e instanceof Error ? e.message : String(e) });
      }
    },
  };
}
