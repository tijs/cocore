// POST /api/internal/wipe
//
// Operator-only sledgehammer. Wipes every console-side table:
// app_sessions (browser cookies), oauth_sessions (PDS auth),
// api_keys, payment_accounts, charge_log, pending_disputes,
// console_user_prefs. Used
// before "go time" cutovers when we're OK signing every dev out and
// dropping their Stripe linkage from our cache.
//
// What this does NOT touch:
//   * Stripe's records of customers / Connect accounts / charges —
//     those live at stripe.com and persist. Devs who re-sign-in will
//     re-link via /api/stripe/checkout and a fresh customer id
//     attaches by email.
//   * The user's PDS — `dev.cocore.compute.*` records on each
//     provider/requester PDS stay until the user invokes "Wipe my
//     data" on /account.
//   * Anything on the services container — call
//     /xrpc/dev.cocore.admin.wipe on the services bridge for that
//     half of the wipe.
//
// Gating:
//   * `Authorization: Bearer <COCORE_INTERNAL_API_KEY>`
//   * AND `COCORE_ALLOW_WIPE=1` on the console process
// Both required. A leaked key alone can't trigger a wipe; a config
// mistake alone can't either.

import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

import { consoleDb } from "@/lib/console-db.server.ts";

function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function authOk(header: string | null): boolean {
  const expected = process.env["COCORE_INTERNAL_API_KEY"];
  if (!expected) return false;
  if (!header) return false;
  const m = /^Bearer\s+(.+)$/.exec(header);
  if (!m) return false;
  const presented = m[1] ?? "";
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

// Tables created by console-db.server.ts. Order matters: nothing here
// is FK-related, but kept in a stable list so the response surface is
// deterministic for logging.
const TABLES = [
  "app_sessions",
  "oauth_sessions",
  "api_keys",
  "payment_accounts",
  "charge_log",
  "pending_disputes",
  "console_user_prefs",
] as const;

export const Route = createFileRoute("/api/internal/wipe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authOk(request.headers.get("authorization"))) {
          return jsonResponse({ error: "unauthorized" }, 401);
        }
        if (process.env["COCORE_ALLOW_WIPE"] !== "1") {
          return jsonResponse(
            { error: "wipe disabled; set COCORE_ALLOW_WIPE=1 on the console container" },
            403,
          );
        }
        const db = consoleDb();
        const counts: Record<string, number> = {};
        for (const table of TABLES) {
          const row = db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(table) as
            | { 1: number }
            | undefined;
          if (!row) continue;
          counts[table] = db.prepare(`DELETE FROM ${table}`).run().changes;
        }
        console.error(`admin.wipe: cleared ${JSON.stringify(counts)}`);
        return jsonResponse({ ok: true, counts });
      },
    },
  },
});
