// Human-friendly latency formatting, shared by the profile page and
// the marketing snapshot. Latency figures come from the AppView's
// receipt-derived rollup (completedAt − startedAt, in ms).

/** Format a millisecond latency for display: sub-second as `Xms`,
 *  otherwise `X.Ys` with one decimal. `null` / non-finite renders as
 *  an em dash so callers can pass through "no samples". */
export function formatLatencyMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
