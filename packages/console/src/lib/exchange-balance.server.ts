// Client for the services container's token-ledger HTTP surface.
//
// The services container holds the per-DID balance ledger (see
// `packages/exchange/src/token-balance.ts`). This file is the
// console-side wrapper that talks to the services endpoints
// mounted under /xrpc/dev.cocore.exchange.* on the bridge port.
//
// Read-only for the console: `getBalance` for the balance card,
// `listEvents` for the recent-activity view. Mint operations
// (issueRefresh, distributePatronage) are server-internal and
// called either from the firehose hook or the patronage scheduler —
// they don't have a console-side wrapper.
//
// Server-side only: imported from server routes / server fns. It
// never ships to the browser.

const COCORE_BRIDGE_URL = process.env["COCORE_BRIDGE_URL"] ?? "http://localhost:8080";

function bridgeUrl(path: string): string {
  return `${COCORE_BRIDGE_URL.replace(/\/$/, "")}${path}`;
}

export interface BalanceResponse {
  did: string;
  balance: number;
  policy: {
    tokenGrant: number;
    tokenFloor: number;
    treasuryFeeBps: number;
    weeklyRefreshAmount: number;
    refreshCadenceMinutes: number;
    patronageFractionBps: number;
    patronageCadenceDays: number;
    /** Display rate used by the earnings / jobs / machines
     *  dashboards to render USD-equivalents alongside token figures.
     *  Defaults to 10. */
    averagePricePerMTok: number;
  };
}

export async function getBalance(did: string): Promise<BalanceResponse> {
  const r = await fetch(
    bridgeUrl(`/xrpc/dev.cocore.exchange.getBalance?did=${encodeURIComponent(did)}`),
  );
  if (!r.ok) {
    throw new Error(`getBalance(${did}) returned ${r.status}: ${await r.text().catch(() => "")}`);
  }
  return (await r.json()) as BalanceResponse;
}

export interface LedgerEvent {
  did: string;
  kind: string;
  tokensDelta: number;
  balanceAfter: number;
  reference: string | null;
  createdAt: string;
}

export async function listEvents(did: string, limit = 50): Promise<{ events: LedgerEvent[] }> {
  const r = await fetch(
    bridgeUrl(`/xrpc/dev.cocore.exchange.listEvents?did=${encodeURIComponent(did)}&limit=${limit}`),
  );
  if (!r.ok) {
    throw new Error(`listEvents(${did}) returned ${r.status}: ${await r.text().catch(() => "")}`);
  }
  return (await r.json()) as { events: LedgerEvent[] };
}

/** Lifetime per-kind roll-up + a newest-first recent feed. Backs the
 *  account-page balance card: `summary` drives the credited / debited
 *  / patronage tiles, `recent` the filterable activity list. */
export interface EventSummary {
  did: string;
  totalCredited: number;
  totalDebited: number;
  net: number;
  byKind: Array<{ kind: string; count: number; total: number }>;
}

export async function getEventSummary(
  did: string,
  limit = 100,
): Promise<{ summary: EventSummary; recent: LedgerEvent[] }> {
  const r = await fetch(
    bridgeUrl(
      `/xrpc/dev.cocore.exchange.eventSummary?did=${encodeURIComponent(did)}&limit=${limit}`,
    ),
  );
  if (!r.ok) {
    throw new Error(
      `getEventSummary(${did}) returned ${r.status}: ${await r.text().catch(() => "")}`,
    );
  }
  return (await r.json()) as { summary: EventSummary; recent: LedgerEvent[] };
}
