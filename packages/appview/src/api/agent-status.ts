// GET /agent/status (+ /api/agent/status alias)
//
// Bearer-key authed provider status for the menu-bar app, served by the
// AppView so a paired agent whose `apiBase` points here (the common case —
// device-pair mints the key into this AppView's AccountStore) gets a real
// answer instead of a 404. Mirrors the console route of the same name: real
// trust level + agent version (from the provider's published record) and
// credit balance + 24h earnings (from the services-bridge ledger running in
// this same process).
//
// Returns the same shape the menu-bar decodes:
//   { did, currency, balance, earned24h, trustLevel, agentVersion }
// Read-only. Credits, not dollars — cocore is a closed-loop token economy.

import { HttpRouter } from "@effect/platform";
import { Effect } from "effect";

import { bearer, err, ok } from "@cocore/o11y/http";

import type { AccountStore } from "../operational/account-store.ts";
import type { Store } from "../store.ts";

export interface AgentStatusContext {
  accounts: AccountStore;
  store: Store;
  /** Bridge base URL — the exchange ledger lives on the bridge in this same
   *  process. When unset, balance/earnings degrade to null/0. */
  bridgeUrl?: string;
}

interface LedgerEvent {
  kind: string;
  tokensDelta: number;
  createdAt: string;
}

const EVENT_LIMIT = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Sum provider income (`receipt-in` credits) at or after `sinceMs`. Mirrors
 *  the console's earnings.ts so both surfaces report the same number. */
function sumReceiptInSince(events: LedgerEvent[], sinceMs: number): number {
  return events.reduce((sum, e) => {
    if (e.kind !== "receipt-in") return sum;
    if (new Date(e.createdAt).getTime() < sinceMs) return sum;
    return sum + Math.max(0, e.tokensDelta);
  }, 0);
}

async function bridgeJson<T>(bridgeUrl: string, path: string): Promise<T | null> {
  try {
    const r = await fetch(`${bridgeUrl.replace(/\/$/, "")}${path}`);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

async function buildStatus(ctx: AgentStatusContext, did: string) {
  const since = Date.now() - DAY_MS;
  const bridge = ctx.bridgeUrl;
  const q = encodeURIComponent(did);
  // Both ledger reads degrade gracefully so a single backend hiccup yields
  // partial data the menu can still render, not a 500.
  const [balance, events] = await Promise.all([
    bridge
      ? bridgeJson<{ balance?: number }>(bridge, `/xrpc/dev.cocore.exchange.getBalance?did=${q}`)
      : Promise.resolve(null),
    bridge
      ? bridgeJson<{ events?: LedgerEvent[] }>(
          bridge,
          `/xrpc/dev.cocore.exchange.listEvents?did=${q}&limit=${EVENT_LIMIT}`,
        )
      : Promise.resolve(null),
  ]);

  const earned24h = sumReceiptInSince(events?.events ?? [], since);

  const providers = ctx.store.listByCollection("dev.cocore.compute.provider", 100);
  const mine = providers.find((p) => p.repo === did);
  const body = (mine?.body ?? {}) as { trustLevel?: string; binaryVersion?: string };

  return {
    did,
    currency: "credits",
    balance: balance?.balance ?? null,
    earned24h,
    trustLevel: body.trustLevel ?? null,
    agentVersion: body.binaryVersion ?? null,
  };
}

/** `/agent/status`. The caller also mounts a `/api/agent/status` alias
 *  (a paired agent's apiBase points at this AppView and appends the path). */
export function buildAgentStatusRouter(
  ctx: AgentStatusContext,
): HttpRouter.HttpRouter<never, never> {
  return HttpRouter.empty.pipe(
    HttpRouter.get(
      "/agent/status",
      Effect.gen(function* () {
        const token = yield* bearer;
        if (!token)
          return err(401, {
            error: "AuthRequired",
            message: "missing Authorization: Bearer header",
          });
        const resolved = ctx.accounts.resolveBearerKey(token);
        if (!resolved) return err(401, { error: "AuthRequired", message: "invalid API key" });
        const status = yield* Effect.promise(() => buildStatus(ctx, resolved.did));
        return ok(status);
      }).pipe(Effect.withSpan("appview.agent.status")),
    ),
  );
}
