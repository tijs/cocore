// POST /api/internal/disputes/resolve
//
// Operator-only endpoint to resolve an open dev.cocore.compute.dispute
// record. The console publishes the resolved record (and, for
// refund verdicts, the compensating refunded settlement) using the
// exchange's OAuth session.
//
// Auth: shared `Authorization: Bearer <COCORE_INTERNAL_API_KEY>`,
// same secret the exchange uses for charge/payout. Same constant-
// time compare. (A separate operator-bearer is overkill for v1
// when everything operator-side already runs in the deploy that
// holds the internal API key.)
//
// Body:
//   {
//     "disputeUri":          "at://...",
//     "verdict":             "refund-full" | "refund-partial" | "uphold-charge" | "forfeit-payout",
//     "rationale":           string?           // free-form, public on the record
//     "refundAmountMinor":   integer?          // required for refund-*
//   }
//
// Response (200):
//   {
//     "disputeUri":          "at://...",
//     "disputeCid":          "...",
//     "refundSettlementUri": "at://..."?,      // present iff verdict was refund-*
//     "refundSettlementCid": "..."?
//   }
//
// Errors:
//   * 401 — Authorization missing / wrong
//   * 400 — body malformed or refund constraints violated
//   * 404 — dispute or referenced settlement not found
//   * 409 — dispute already resolved
//   * 503 — exchange has no OAuth session on file (operator must
//           sign in to the console as the exchange's DID first)

import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

import { ResolveDisputeError, resolveDispute } from "@/lib/disputes-resolve.server.ts";

interface ResolveBody {
  disputeUri?: unknown;
  verdict?: unknown;
  rationale?: unknown;
  refundAmountMinor?: unknown;
}

const ALLOWED_VERDICTS = new Set([
  "refund-full",
  "refund-partial",
  "uphold-charge",
  "forfeit-payout",
]);

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

function parseBody(raw: unknown): {
  disputeUri: string;
  verdict: "refund-full" | "refund-partial" | "uphold-charge" | "forfeit-payout";
  rationale?: string;
  refundAmountMinor?: number;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as ResolveBody;
  if (typeof b.disputeUri !== "string" || !b.disputeUri.startsWith("at://")) return null;
  if (typeof b.verdict !== "string" || !ALLOWED_VERDICTS.has(b.verdict)) return null;
  const rationale = typeof b.rationale === "string" ? b.rationale : undefined;
  let refundAmountMinor: number | undefined;
  if (b.refundAmountMinor !== undefined) {
    if (typeof b.refundAmountMinor !== "number" || !Number.isInteger(b.refundAmountMinor)) {
      return null;
    }
    refundAmountMinor = b.refundAmountMinor;
  }
  return {
    disputeUri: b.disputeUri,
    verdict: b.verdict as ReturnType<typeof parseBody> extends infer R
      ? R extends { verdict: infer V }
        ? V
        : never
      : never,
    ...(rationale !== undefined ? { rationale } : {}),
    ...(refundAmountMinor !== undefined ? { refundAmountMinor } : {}),
  };
}

function statusFor(code: string): number {
  switch (code) {
    case "exchange-not-onboarded":
      return 503;
    case "already-resolved":
      return 409;
    case "bad-uri":
    case "bad-refund-amount":
    case "refund-amount-mismatch":
    case "refund-amount-too-large":
    case "settlement-not-mine":
      return 400;
    case "refund-publish-failed":
    case "putRecord-failed":
      return 502;
    default:
      return 500;
  }
}

export const Route = createFileRoute("/api/internal/disputes/resolve")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authOk(request.headers.get("authorization"))) {
          return jsonResponse({ error: "unauthorized" }, 401);
        }
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ error: "bad-json" }, 400);
        }
        const parsed = parseBody(body);
        if (!parsed) return jsonResponse({ error: "bad-body" }, 400);
        try {
          const result = await resolveDispute(parsed);
          return jsonResponse(result);
        } catch (e) {
          if (e instanceof ResolveDisputeError) {
            return jsonResponse({ error: e.code, message: e.message }, statusFor(e.code));
          }
          throw e;
        }
      },
    },
  },
});
