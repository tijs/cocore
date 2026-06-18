// Time-to-first-token (TTFT) tracker.
//
// The advisor is the one place that sees both ends of the user-facing
// latency: it receives a `/jobs` request and relays the provider's first
// `inference_chunk` back to the requester. TTFT = (first chunk relayed) −
// (job received). That's the "how fast does it START responding" number —
// what people actually mean by latency — as opposed to a receipt's
// `completedAt − startedAt`, which is total generation time and scales with
// output length, not responsiveness.
//
// In-memory, rolling: we keep the last `capacity` samples and report
// percentiles over them. Lost on restart (the advisor's whole registry is),
// which is fine — it's a "typical RECENT latency" headline, not an SLA
// ledger, and it repopulates within a handful of jobs.

export interface TtftStats {
  /** Samples currently in the window (≤ capacity). */
  sampleCount: number;
  /** Median TTFT in ms, or null when there are no samples. */
  p50Ms: number | null;
  /** 95th-percentile TTFT in ms, or null when there are no samples. */
  p95Ms: number | null;
  /** Mean TTFT in ms, or null when there are no samples. */
  avgMs: number | null;
  /** The most recent sample's TTFT in ms, or null. */
  lastMs: number | null;
}

export class TtftWindow {
  private readonly samples: number[] = [];
  private readonly capacity: number;

  constructor(capacity = 100) {
    this.capacity = Math.max(1, capacity);
  }

  /** Record one TTFT sample (ms). Non-finite or negative values are
   *  dropped — a clock skew or a malformed timing shouldn't poison the
   *  median. Oldest sample falls off once the window is full. */
  record(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.samples.push(ms);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  stats(): TtftStats {
    const n = this.samples.length;
    if (n === 0) return { sampleCount: 0, p50Ms: null, p95Ms: null, avgMs: null, lastMs: null };
    const sorted = [...this.samples].sort((a, b) => a - b);
    const pct = (p: number): number => {
      // Nearest-rank percentile over the sorted window.
      const idx = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1));
      return sorted[idx]!;
    };
    const sum = this.samples.reduce((a, b) => a + b, 0);
    return {
      sampleCount: n,
      p50Ms: pct(50),
      p95Ms: pct(95),
      avgMs: Math.round(sum / n),
      lastMs: this.samples[n - 1]!,
    };
  }
}
