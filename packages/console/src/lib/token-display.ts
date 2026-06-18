// Token display helpers for the logged-in console. Under closed-loop
// the ledger is token-denominated end-to-end, but several dashboards
// (earnings / jobs) still receive legacy USD-shaped numbers from the
// historical settlement records and need to render them in tokens.
//
// `avgPricePerMTok` (minor USD per million tokens) comes from the
// active exchange policy via `getMyBalanceQueryOptions`. It exists
// purely as a back-compat display ratio for those legacy rows.

/** Convert decimal USD (e.g. 1.50) to whole tokens at the given rate.
 *  Returns 0 if the rate is missing/zero so callers can pass policy
 *  data through without guarding. */
export function usdMajorToTokens(usdMajor: number, avgPricePerMTok: number): number {
  if (!Number.isFinite(usdMajor) || !Number.isFinite(avgPricePerMTok) || avgPricePerMTok <= 0) {
    return 0;
  }
  return Math.round((usdMajor * 100 * 1_000_000) / avgPricePerMTok);
}

/** Locale-fixed thousands-separated full count: "10,000,000". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

/** Compact form for chart axes & sparkline tooltips: "1.2M", "150K",
 *  "9,200". Uses Intl.NumberFormat compact notation when available
 *  and falls back to a hand-rolled formatter so SSR and CSR match. */
export function formatTokensCompact(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) {
    const major = abs / 1_000_000;
    return `${sign}${trimZero(major)}M`;
  }
  if (abs >= 1_000) {
    const major = abs / 1_000;
    return `${sign}${trimZero(major)}K`;
  }
  return `${sign}${Math.round(abs).toLocaleString("en-US")}`;
}

function trimZero(n: number): string {
  // 1.20 -> "1.2", 1.00 -> "1", 12.4 -> "12"
  if (n >= 10) return String(Math.round(n));
  const fixed = n.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}
