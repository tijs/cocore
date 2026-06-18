// Client for the services container's leaderboard endpoint.
//
// The services container holds the per-DID token ledger (see
// `packages/exchange/src/token-balance.ts`). This file is the
// console-side wrapper that reads the ranked leaderboard mounted at
// /xrpc/dev.cocore.exchange.leaderboard on the bridge port. It returns
// raw `{ did, amount }` rows; handle/avatar hydration happens in the
// leaderboard server fn (`components/leaderboard/leaderboard.functions.ts`).
//
// Server-side only: imported from server fns. It never ships to the
// browser.

const COCORE_BRIDGE_URL = process.env["COCORE_BRIDGE_URL"] ?? "http://localhost:8080";

function bridgeUrl(path: string): string {
  return `${COCORE_BRIDGE_URL.replace(/\/$/, "")}${path}`;
}

export interface LeaderboardEntry {
  did: string;
  amount: number;
}

export interface LeaderboardResponse {
  generatedAt: string;
  /** Largest current wallets (token balance). */
  topBalances: LeaderboardEntry[];
  /** Most tokens received as a provider (sum of receipt-in events). */
  topEarners: LeaderboardEntry[];
  /** Most tokens spent as a requester (sum of receipt-out events). */
  topSpenders: LeaderboardEntry[];
}

export async function getLeaderboard(limit = 20): Promise<LeaderboardResponse> {
  const r = await fetch(bridgeUrl(`/xrpc/dev.cocore.exchange.leaderboard?limit=${limit}`));
  if (!r.ok) {
    throw new Error(`getLeaderboard returned ${r.status}: ${await r.text().catch(() => "")}`);
  }
  return (await r.json()) as LeaderboardResponse;
}
