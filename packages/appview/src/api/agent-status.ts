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
  /** Advisor HTTP base — used to read this machine's VERIFIED confidential
   *  standing (and, when the owner wants confidential, the blocking leg). When
   *  unset, confidential degrades to not-verified / no-reason. */
  advisorUrl?: string;
}

interface ConfidentialLegs {
  selfTierConfidential?: boolean;
  cdHashKnownGood?: boolean;
  challengeVerifiedSip?: boolean;
  codeAttested?: boolean;
}

/** Map the advisor's per-leg breakdown to ONE operator-facing reason, in
 *  most-actionable-first order. Returns null when every leg holds. Kept in
 *  sync with the console route of the same name. */
function blockingLegReason(legs: ConfidentialLegs): string | null {
  if (legs.selfTierConfidential === false)
    return "The agent hasn't come up on the confidential worker yet — it's still starting or restarting.";
  if (legs.cdHashKnownGood === false)
    return "This build isn't recognized yet (its code hash isn't in the known-good set). Update to the latest secure build.";
  if (legs.challengeVerifiedSip === false)
    return "System Integrity Protection looks disabled on this Mac — confidential serving needs SIP on.";
  if (legs.codeAttested === false)
    return "Waiting for this Mac to answer the hardware code-identity challenge. This can take a moment after the agent (re)starts.";
  return null;
}

/** This machine's VERIFIED confidential standing from the advisor, plus the
 *  blocking leg when not verified. Mirrors the console's fetchConfidentialStanding;
 *  degrades to not-verified / no-reason when no advisor is configured or it's
 *  unreachable ("can't tell", distinct from a known leg failure). */
async function fetchConfidentialStanding(
  advisorUrl: string | undefined,
  did: string,
): Promise<{ verified: boolean; blockedReason: string | null }> {
  if (!advisorUrl) return { verified: false, blockedReason: null };
  try {
    const base = advisorUrl.replace(/\/$/, "");
    const r = await fetch(`${base}/providers`);
    if (!r.ok) return { verified: false, blockedReason: null };
    const list = (await r.json()) as Array<{
      did: string;
      confidentialEligible?: boolean;
      trustTier?: string;
      confidentialLegs?: ConfidentialLegs;
    }>;
    const mine = list.filter((p) => p.did === did);
    const verified = mine.some(
      (p) => p.confidentialEligible === true || p.trustTier === "attested-confidential",
    );
    if (verified) return { verified: true, blockedReason: null };
    const best = mine.find((p) => p.confidentialLegs?.selfTierConfidential) ?? mine[0];
    if (!best)
      return {
        verified: false,
        blockedReason:
          "This Mac isn't connected to the co/core network yet — confidential can't be verified until it is.",
      };
    return { verified: false, blockedReason: blockingLegReason(best.confidentialLegs ?? {}) };
  } catch {
    return { verified: false, blockedReason: null };
  }
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
  const body = (mine?.body ?? {}) as {
    trustLevel?: string;
    binaryVersion?: string;
    desiredTier?: string;
  };

  const standing = await fetchConfidentialStanding(ctx.advisorUrl, did);
  // The owner's DURABLE intent (written by `agent confidential`), distinct from
  // the advisor's verified standing — the app needs both to render an honest
  // "Applying… / Active / Best-effort" instead of a boolean that looks forgotten
  // during the verify window.
  const confidentialDesired = body.desiredTier === "attested-confidential";
  const confidentialBlockedReason =
    confidentialDesired && !standing.verified ? standing.blockedReason : null;

  return {
    did,
    currency: "credits",
    balance: balance?.balance ?? null,
    earned24h,
    trustLevel: body.trustLevel ?? null,
    agentVersion: body.binaryVersion ?? null,
    // `confidential` stays = verified for back-compat; new app builds read
    // confidentialVerified/Desired/BlockedReason.
    confidential: standing.verified,
    confidentialVerified: standing.verified,
    confidentialDesired,
    confidentialBlockedReason,
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
