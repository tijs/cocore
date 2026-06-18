/** Pure jobs dashboard types + transforms — safe for client and server bundles. */

export type JobsTimeRange = "today" | "7d" | "30d" | "all";

export type RequesterJobRow = {
  jobUri: string;
  jobRkey: string;
  model: string;
  inputCommitmentShort: string;
  createdAt: string;
  expiresAt: string;
  priceCeiling: { amount: number; currency: string };
  status: "completed" | "pending" | "expired";
  providerDid: string | null;
  /** Resolved handle for {@link providerDid} (who ran the job), or null
   *  when unresolved — filled by the jobs server fn, not the pure
   *  transform. The table links to the provider's profile either way. */
  providerHandle: string | null;
  /** Resolved display name for the provider, when known. */
  providerDisplayName: string | null;
  receiptUri: string | null;
  startedAt: string | null;
  completedAt: string | null;
  charged: { amount: number; currency: string } | null;
  tokensIn: number | null;
  tokensOut: number | null;
};

/** Convert lexicon money minor units to a decimal display amount (USD → dollars). */
export function minorToMajorUsd(amount: number, currency: string): number {
  const c = currency.toUpperCase();
  if (c === "USD" || c === "EUR" || c === "GBP") return amount / 100;
  return amount;
}

/** RFC3339 → ms, or `null` if invalid (never `NaN`). */
export function parseTimeMs(iso: string | undefined | null): number | null {
  if (iso == null || typeof iso !== "string" || iso.length === 0) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function sortRequesterJobRows(rows: RequesterJobRow[]): RequesterJobRow[] {
  return sortRequesterJobRowsForTable(rows, "created", "desc");
}

export type JobsTableSortKey = "created" | "duration" | "price";

/** Elapsed ms from started→completed, or `null` if unknown / invalid. */
function rowDurationMs(row: RequesterJobRow): number | null {
  const s = parseTimeMs(row.startedAt);
  const e = parseTimeMs(row.completedAt);
  if (s == null || e == null) return null;
  const d = e - s;
  return Number.isFinite(d) && d >= 0 ? d : null;
}

/** Minor units for sort: charged price else ceiling (matches displayed price column). */
function rowPriceComparable(row: RequesterJobRow): { currency: string; amount: number } {
  const p = row.charged ?? row.priceCeiling;
  return { currency: p.currency.toUpperCase(), amount: p.amount };
}

/**
 * Stable sort for the jobs table. Missing durations sort last for both directions.
 * Price: currency A–Z, then amount low→high or high→low within a currency.
 */
export function sortRequesterJobRowsForTable(
  rows: RequesterJobRow[],
  sortKey: JobsTableSortKey,
  direction: "asc" | "desc",
): RequesterJobRow[] {
  return [...rows].sort((a, b) => {
    if (sortKey === "price") {
      const pa = rowPriceComparable(a);
      const pb = rowPriceComparable(b);
      const cr = pa.currency.localeCompare(pb.currency);
      if (cr !== 0) return cr;
      const amt = pa.amount - pb.amount;
      const cmp = direction === "desc" ? -amt : amt;
      if (cmp !== 0) return cmp;
      return a.jobUri.localeCompare(b.jobUri);
    }

    let cmp = 0;
    if (sortKey === "created") {
      const ta = parseTimeMs(a.createdAt) ?? 0;
      const tb = parseTimeMs(b.createdAt) ?? 0;
      cmp = ta - tb;
    } else {
      const da = rowDurationMs(a);
      const db = rowDurationMs(b);
      const va = da ?? Number.POSITIVE_INFINITY;
      const vb = db ?? Number.POSITIVE_INFINITY;
      cmp = va - vb;
    }
    if (direction === "desc") cmp = -cmp;
    if (cmp !== 0) return cmp;
    return a.jobUri.localeCompare(b.jobUri);
  });
}

function rangeStartMs(range: JobsTimeRange, nowMs: number): number {
  if (!Number.isFinite(nowMs)) return 0;
  if (range === "all") return 0;
  if (range === "today") {
    const d = new Date(nowMs);
    if (!Number.isFinite(d.getTime())) return 0;
    d.setUTCHours(0, 0, 0, 0);
    const t = d.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  const days = range === "7d" ? 7 : 30;
  const start = nowMs - days * 86_400_000;
  return Number.isFinite(start) ? start : 0;
}

/** Range filter anchor: `createdAt` (when the requester submitted the job). */
function rowAnchorMs(row: RequesterJobRow): number | null {
  return parseTimeMs(row.createdAt);
}

export function filterRowsByRange(
  rows: RequesterJobRow[],
  range: JobsTimeRange,
  nowMs: number,
): RequesterJobRow[] {
  if (range === "all") return rows;
  if (!Number.isFinite(nowMs)) return rows;
  const start = rangeStartMs(range, nowMs);
  if (!Number.isFinite(start)) return rows;
  return rows.filter((r) => {
    const t = rowAnchorMs(r);
    if (t == null) return false;
    return t >= start && t <= nowMs;
  });
}

export type JobsRangeStats = {
  completed: number;
  pending: number;
  expired: number;
  /** Total charged across completed jobs, in tokens (credits). Charges
   *  are priced in CC at 1 minor unit = 1 token. */
  spendTokens: number;
};

export const emptyJobsRangeStats: JobsRangeStats = {
  completed: 0,
  pending: 0,
  expired: 0,
  spendTokens: 0,
};

/** Tokens charged for a completed job, or 0 if it isn't a CC charge we
 *  can count. cocore is a closed-loop credit system — charges are
 *  denominated in CC (1 minor unit = 1 token). The earlier code only
 *  summed `currency === "USD"`, so real (CC) charges never counted and
 *  the spend metrics read 0. */
function chargeTokens(charged: { amount: number; currency: string } | null): number {
  if (!charged) return 0;
  if (charged.currency.toUpperCase() !== "CC") return 0;
  return Number.isFinite(charged.amount) ? charged.amount : 0;
}

export function statsForVisibleRows(rows: RequesterJobRow[]): JobsRangeStats {
  let spendTokens = 0;
  let completed = 0;
  let pending = 0;
  let expired = 0;
  for (const r of rows) {
    if (r.status === "completed") {
      completed += 1;
      spendTokens += chargeTokens(r.charged);
    } else if (r.status === "pending") pending += 1;
    else expired += 1;
  }
  return {
    completed,
    pending,
    expired,
    spendTokens: Number.isFinite(spendTokens) ? spendTokens : 0,
  };
}
