// Server fns + react-query options for the per-DID token balance.
//
// The UI only needs to read the balance + recent events. Mints
// (grants, refreshes, patronage rebates) flow in via the firehose /
// scheduler; debits (receipt-out for jobs the user dispatched,
// treasury-fee on receipts they served) flow as side effects of
// normal use. The card on /account is read-only.

import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";

import {
  type BalanceResponse,
  getBalance,
  getEventSummary,
} from "@/lib/exchange-balance.server.ts";
import { authMiddleware } from "@/middleware/auth.ts";

const getMyBalanceServerFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(({ context }): Promise<BalanceResponse> => getBalance(context.oauthSession.did));

export const getMyBalanceQueryOptions = queryOptions({
  queryKey: ["token-balance", "me"] as const,
  queryFn: getMyBalanceServerFn,
  staleTime: 10_000,
});

// Lifetime aggregates + a newest-first recent feed in one call. The
// feed is pulled "desc" server-side so a fresh patronage rebate lands
// at the top of the card rather than scrolling off the end of an
// oldest-first window (which is why rebates used to be invisible).
const getMyActivityServerFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(({ context }) => getEventSummary(context.oauthSession.did, 200));

export const getMyActivityQueryOptions = queryOptions({
  queryKey: ["token-balance", "me", "activity"] as const,
  queryFn: getMyActivityServerFn,
  staleTime: 10_000,
});
