// Server functions for the operator-only /admin/disputes page.
//
// Two server fns:
//   * listPendingDisputesQueryOptions — reads the
//     pending_disputes SQLite table. Auth-gated by the
//     authMiddleware AND a runtime check that the signed-in DID
//     equals cocoreConfig().exchangeDid (the only DID with any
//     business adjudicating). Non-exchange users get a 403.
//   * resolvePendingDisputeMutationOptions — calls the resolve
//     helper directly (skips the HTTP /api/internal/disputes/resolve
//     loop since we already have the exchange's OAuth context via
//     the cookie). Same auth check.

import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { cocoreConfig } from "@/lib/cocore-config.ts";
import { consoleDb } from "@/lib/console-db.server.ts";
import { ResolveDisputeError, resolveDispute } from "@/lib/disputes-resolve.server.ts";
import { authMiddleware } from "@/middleware/auth.ts";

export interface PendingDisputeRow {
  stripeDisputeId: string;
  paymentIntentId: string;
  stripeReason: string;
  status: string;
  disputeUri: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DbRow {
  stripe_dispute_id: string;
  payment_intent_id: string;
  stripe_reason: string;
  status: string;
  dispute_uri: string | null;
  created_at: string;
  updated_at: string;
}

function rowFromDb(r: DbRow): PendingDisputeRow {
  return {
    stripeDisputeId: r.stripe_dispute_id,
    paymentIntentId: r.payment_intent_id,
    stripeReason: r.stripe_reason,
    status: r.status,
    disputeUri: r.dispute_uri,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

class NotExchangeOperator extends Error {
  constructor() {
    super("only the exchange DID can adjudicate disputes");
    this.name = "NotExchangeOperator";
  }
}

function assertIsExchangeOperator(callerDid: string): void {
  const expected = cocoreConfig().exchangeDid;
  if (callerDid !== expected) throw new NotExchangeOperator();
}

interface ListPayload {
  rows: PendingDisputeRow[];
  exchangeDid: string;
}

const listServerFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(({ context }): ListPayload => {
    assertIsExchangeOperator(context.did);
    const rows = consoleDb()
      .prepare(
        `SELECT stripe_dispute_id, payment_intent_id, stripe_reason,
                status, dispute_uri, created_at, updated_at
           FROM pending_disputes
          ORDER BY created_at DESC
          LIMIT 500`,
      )
      .all() as DbRow[];
    return {
      rows: rows.map(rowFromDb),
      exchangeDid: context.did,
    };
  });

export const listPendingDisputesQueryOptions = queryOptions({
  queryKey: ["admin", "pending-disputes"] as const,
  queryFn: listServerFn,
  staleTime: 15_000,
});

const resolveSchema = z.object({
  disputeUri: z.string().min(1).max(400),
  verdict: z.enum(["refund-full", "refund-partial", "uphold-charge", "forfeit-payout"]),
  rationale: z.string().max(2048).optional(),
  refundAmountMinor: z.number().int().positive().optional(),
});

export type ResolveDisputeInput = z.infer<typeof resolveSchema>;

const resolveServerFn = createServerFn({ method: "POST" })
  .inputValidator(resolveSchema)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    assertIsExchangeOperator(context.did);
    try {
      return await resolveDispute(data);
    } catch (e) {
      if (e instanceof ResolveDisputeError) {
        // Surface the helper's structured code through to the UI
        // so it can render a useful toast.
        throw new Error(`${e.code}: ${e.message}`);
      }
      throw e;
    }
  });

export const resolvePendingDisputeMutationOptions = mutationOptions({
  mutationFn: (input: ResolveDisputeInput) => resolveServerFn({ data: input }),
});
