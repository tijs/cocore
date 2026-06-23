// GET /api/agent/status
//
// Bearer-key authed provider status for the menu-bar app. Returns the
// real trust level + agent version (from the published provider record)
// and the credit balance + 24h earnings (from the services-bridge
// ledger). Same API-key auth as /api/agent/whoami; read-only.
//
// Credits, not dollars: cocore is a closed-loop token economy. Provider
// income lands as `receipt-in` ledger events (see
// packages/exchange/src/token-balance.ts).

import type { Did } from "@atcute/lexicons";
import { createFileRoute } from "@tanstack/react-router";

import { runTraced } from "@/lib/o11y.server.ts";

import { appviewListProvidersEffect } from "@/integrations/appview/appview.server.ts";
import { sessionNeedsReauth } from "@/integrations/auth/atproto.server.ts";
import { resolveBearerKey } from "@/lib/api-keys.server.ts";
import { cocoreConfig } from "@/lib/cocore-config.ts";
import { sumReceiptInSince } from "@/lib/earnings.ts";
import { getBalance, listEvents } from "@/lib/exchange-balance.server.ts";

// The ledger client returns most-recent-first; 500 covers any realistic
// 24h provider volume. A heavier provider would need a dedicated 24h
// aggregate on the bridge — tracked as a follow-up.
const EVENT_LIMIT = 500;

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

/** The advisor's VERIFIED confidential standing for this machine — its
 *  cdHash is known-good AND its challenge-verified posture holds. This is
 *  the same signal the console model directory badges with, and it's the
 *  honest one to show the operator (vs the provider record's self-asserted
 *  trustLevel). Degrades to false when the advisor is unreachable. */
async function fetchConfidentialEligible(did: string): Promise<boolean> {
  try {
    const base = cocoreConfig().advisorUrl.replace(/\/$/, "");
    const r = await fetch(`${base}/providers`);
    if (!r.ok) return false;
    const list = (await r.json()) as Array<{
      did: string;
      confidentialEligible?: boolean;
      trustTier?: string;
    }>;
    // A DID can hold MULTIPLE advisor rows: one per connected machine, plus
    // stale ghost registrations that haven't aged out yet. The old `.find`
    // returned the FIRST matching row, which was frequently the stale
    // best-effort ghost — so the menu showed "not confidential" even though
    // the live worker was attested. Treat the DID as confidential-eligible
    // when ANY of its rows is: the live attested row wins over a stale ghost.
    return list.some(
      (p) =>
        p.did === did &&
        (p.confidentialEligible === true || p.trustTier === "attested-confidential"),
    );
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/agent/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const bearer = readBearer(request);
        if (!bearer) return jsonError(401, "missing Authorization: Bearer header");
        const resolved = resolveBearerKey(bearer);
        if (!resolved) return jsonError(401, "invalid API key");

        const did = resolved.did;
        const since = Date.now() - 24 * 60 * 60 * 1000;

        // "Does the agent need a fresh sign-in?" — a NON-refreshing read of
        // the stored OAuth session (see sessionNeedsReauth). The old probe
        // called restore(), which refreshes/rotates the single-use refresh
        // token on every status poll; because the AppView is the designated
        // refresher, that parallel rotation was cannibalizing the session it
        // was meant to monitor and causing the recurring write 401s. This
        // read only reports re-auth when the session is genuinely gone.
        const needsReauth = sessionNeedsReauth(did as Did);

        // All three degrade gracefully so a single backend hiccup yields
        // partial data the menu can still render, not a 500.
        const [balance, events, providers, confidential] = await Promise.all([
          getBalance(did).catch(() => null),
          listEvents(did, EVENT_LIMIT).catch(() => ({ events: [] })),
          runTraced("appview.listProviders", appviewListProvidersEffect).catch(() => ({
            providers: [],
          })),
          fetchConfidentialEligible(did),
        ]);

        const earned24h = sumReceiptInSince(events.events, since);

        const mine = providers.providers.find((p) => p.repo === did);
        const body = (mine?.body ?? {}) as { trustLevel?: string; binaryVersion?: string };

        return new Response(
          JSON.stringify({
            did,
            currency: "credits",
            balance: balance?.balance ?? null,
            earned24h,
            trustLevel: body.trustLevel ?? null,
            confidential,
            agentVersion: body.binaryVersion ?? null,
            needsReauth,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
