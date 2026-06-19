// Human-friendly RAM formatting for marketing and explorer surfaces.
// Inputs are whole gigabytes as reported on provider records (`ramGB`).

const GB_PER_TB = 1024;
const GB_PER_PB = GB_PER_TB * 1024;
const GB_PER_EB = GB_PER_PB * 1024;

const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function trimZero(n: number): string {
  if (n >= 10) return String(Math.round(n));
  const fixed = n.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

/** Format a gigabyte total for display, scaling to TB/PB/EB when large
 *  enough that raw GB would be unwieldy. Returns separate value and
 *  unit strings so callers can style the unit like other stats-strip
 *  metrics (`1.5` + `TB RAM`). */
export function formatRamGB(gb: number | null | undefined): { value: string; unit: string } {
  if (gb === null || gb === undefined || !Number.isFinite(gb) || gb < 0) {
    return { value: "—", unit: "RAM" };
  }
  if (gb === 0) {
    return { value: "0", unit: "GB RAM" };
  }
  if (gb < GB_PER_TB) {
    return { value: intFmt.format(Math.round(gb)), unit: "GB RAM" };
  }
  if (gb < GB_PER_PB) {
    return { value: trimZero(gb / GB_PER_TB), unit: "TB RAM" };
  }
  if (gb < GB_PER_EB) {
    return { value: trimZero(gb / GB_PER_PB), unit: "PB RAM" };
  }
  return { value: trimZero(gb / GB_PER_EB), unit: "EB RAM" };
}
