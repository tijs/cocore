// Shared, cross-cutting metric instruments.
//
// These are plain Effect `Metric`s. When a service runs effects through a
// runtime whose layer includes the OTLP `metricReader` (see tracing.ts),
// Effect exports them automatically; otherwise they accumulate in-process
// and are never read — a no-op cost.
//
// Record by piping an effect through `Metric.increment(...)` /
// `Metric.update(...)`, or use the helpers below. Tag dimensions
// (`outcome`, `kind`, ...) must stay low-cardinality — never tag with a
// DID, URI, or anything per-request.

import { Duration, Effect, Metric, MetricBoundaries } from "effect";

/** Receipts observed and indexed off the firehose. */
export const receiptsIndexed = Metric.counter("cocore.receipts.indexed", {
  description: "dev.cocore.compute.receipt records indexed",
});

/** Jobs dispatched to providers. */
export const jobsDispatched = Metric.counter("cocore.jobs.dispatched", {
  description: "inference jobs dispatched to providers",
});

/** Settlement attempts, tagged by outcome. Use `settlementOutcome(tag)`. */
const settlements = Metric.counter("cocore.settlements", {
  description: "settlement attempts by outcome",
});

/** Counter for settlement attempts tagged with a low-cardinality outcome
 *  (e.g. "settled", "rejected", "deferred"). */
export function settlementOutcome(outcome: string) {
  return settlements.pipe(Metric.tagged("outcome", outcome));
}

/** Tokens moved through the ledger, split by direction ("in" | "out"). */
const tokens = Metric.counter("cocore.tokens", {
  description: "tokens accounted, by direction",
  incremental: true,
});
export function tokenThroughput(direction: "in" | "out") {
  return tokens.pipe(Metric.tagged("direction", direction));
}

/** Request/operation latency in milliseconds. Boundaries cover sub-ms to
 *  ~1min, which fits both fast index reads and slow inference dispatch. */
export const requestDurationMs = Metric.histogram(
  "cocore.request.duration_ms",
  MetricBoundaries.exponential({ start: 1, factor: 2, count: 16 }),
  "operation latency in milliseconds",
);

/** Time an effect and record its wall-clock duration into
 *  {@link requestDurationMs}. The effect's value is passed through. */
export function timed<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return Effect.timed(effect).pipe(
    Effect.tap(([duration]) => Metric.update(requestDurationMs, Duration.toMillis(duration))),
    Effect.map(([, value]) => value),
  );
}
