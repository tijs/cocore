// Server fn + query options for the public leaderboard page.
//
// Pulls the ranked `{ did, amount }` rows from the services
// container's ledger endpoint (`lib/exchange-leaderboard.server.ts`),
// then hydrates the union of DIDs across the three lists into
// handle / display name / avatar via the public bsky appview. The
// hydration is deduped — a DID that tops two lists is resolved once.
//
// No auth: the leaderboard is a public, read-only view. The heavy
// part (the per-DID profile lookups) is cached server-side for a TTL
// in the bridge and again here via React Query staleTime, so warm
// loads do no fan-out.

import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getLeaderboard, type LeaderboardEntry } from "@/lib/exchange-leaderboard.server.ts";
import { appviewProfileFieldsForDid, lookupActor } from "@/lib/friends.server.ts";

/** One ranked, display-ready row. `rank` is 1-based within its list. */
export interface LeaderboardRow {
  rank: number;
  did: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  amount: number;
}

export interface LeaderboardPayload {
  generatedAt: string;
  /** Largest current wallets (token balance). */
  topBalances: LeaderboardRow[];
  /** Most tokens earned as a provider. */
  topEarners: LeaderboardRow[];
  /** Most tokens spent as a requester. */
  topSpenders: LeaderboardRow[];
}

const leaderboardSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

type Hydrated = { handle: string | null; displayName: string | null; avatarUrl: string | null };

const leaderboardServerFn = createServerFn({ method: "GET" })
  .inputValidator(leaderboardSchema)
  .handler(async ({ data }): Promise<LeaderboardPayload> => {
    const limit = data.limit ?? 20;
    const board = await getLeaderboard(limit);

    // Resolve every distinct DID once, in parallel. A failed lookup
    // (deleted account, transient bsky error) degrades to null fields
    // and the UI falls back to showing the raw DID.
    const dids = new Set<string>();
    for (const list of [board.topBalances, board.topEarners, board.topSpenders]) {
      for (const e of list) dids.add(e.did);
    }
    const resolved = new Map<string, Hydrated>();
    await Promise.all(
      [...dids].map(async (did) => {
        const lookup = await lookupActor(did).catch(() => null);
        const { avatarUrl, displayName, displayHandle } = appviewProfileFieldsForDid(
          lookup,
          did,
          null,
        );
        resolved.set(did, { handle: displayHandle, displayName, avatarUrl });
      }),
    );

    const enrich = (list: LeaderboardEntry[]): LeaderboardRow[] =>
      list.map((e, i) => {
        const h = resolved.get(e.did) ?? { handle: null, displayName: null, avatarUrl: null };
        return { rank: i + 1, did: e.did, amount: e.amount, ...h };
      });

    return {
      generatedAt: board.generatedAt,
      topBalances: enrich(board.topBalances),
      topEarners: enrich(board.topEarners),
      topSpenders: enrich(board.topSpenders),
    };
  });

export type LeaderboardInput = z.infer<typeof leaderboardSchema>;

export function leaderboardQueryOptions(input: LeaderboardInput = {}) {
  return queryOptions({
    queryKey: ["leaderboard", input] as const,
    queryFn: (): Promise<LeaderboardPayload> => leaderboardServerFn({ data: input }),
    // The board turns over slowly and the server fn pays a per-DID
    // hydration cost; cache it for a few minutes and keep it in memory
    // so revisiting doesn't re-pay the round-trip.
    staleTime: 120_000,
    gcTime: 600_000,
  });
}
