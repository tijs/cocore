// Tiny query-string parsing helpers shared by the AppView route modules.

/** Parse an integer query param, or fall back to `dflt`. */
export function parseIntOr(raw: string | null, dflt: number): number {
  if (raw === null) return dflt;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : dflt;
}

/** Same as {@link parseIntOr} but clamps into a `[min, max]` range. */
export function clampInt(raw: string | null, dflt: number, min: number, max: number): number {
  const v = parseIntOr(raw, dflt);
  return Math.min(Math.max(v, min), max);
}
