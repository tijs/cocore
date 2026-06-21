// Per-service Effect runtime + the `runTraced` boundary helper.
//
// A service builds one runtime at startup with `makeRuntime(...)` and runs
// every request/job through `runTraced(runtime, name, effect)`, which
// wraps the effect in a root span named for the operation. When OTLP is
// disabled the tracing layer is `Layer.empty`, so this is a thin wrapper
// over `Effect.runPromise` with no overhead.
//
// `makeRuntime` optionally takes an application `Layer` (the service's
// `AppLayer` of `Effect.Service`s — e.g. an HTTP client). It is merged with
// the tracing layer so a single runtime provides both telemetry and the
// app's dependencies, and `runTraced` accepts any effect whose
// requirements the runtime satisfies.

import { Effect, Layer, ManagedRuntime } from "effect";

import { otlpEnabled, sdkLayer, type O11yConfig } from "./tracing.ts";

/** Build the telemetry runtime for a service. Call once at startup and
 *  reuse the returned runtime for every operation. Pass an `appLayer` to
 *  also provide the service's own dependencies (an `AppLayer`). */
export function makeRuntime<ROut = never, E = never>(
  config: O11yConfig,
  appLayer?: Layer.Layer<ROut, E, never>,
): O11yRuntime<ROut> {
  const tracing = otlpEnabled() ? sdkLayer(config) : Layer.empty;
  const app = appLayer ?? Layer.empty;
  // The `??` widens `app` to a union TS can't follow through `Layer.merge`,
  // and the tracing layer adds an internal `Resource` output that is not a
  // caller-facing requirement. Assert the runtime's environment is exactly
  // the app services `ROut` — the set `runTraced` requires effects to fit.
  return ManagedRuntime.make(Layer.merge(app, tracing)) as O11yRuntime<ROut>;
}

export type O11yRuntime<R = never> = ManagedRuntime.ManagedRuntime<R, never>;

/** Attribute values we allow on a span. Keep these to IDs/DIDs/sizes/
 *  hashes/counts/durations — never prompt/output content or secrets. */
export type SpanAttributes = Record<string, string | number | boolean | undefined>;

/** Run an effect through a runtime, wrapped in a root span. Drop-in
 *  replacement for `Effect.runPromise(effect)` at a service boundary. The
 *  effect's requirements `R` must be satisfied by the runtime. */
export function runTraced<A, E, R>(
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
  name: string,
  effect: Effect.Effect<A, E, R>,
  attributes?: SpanAttributes,
): Promise<A> {
  return runtime.runPromise(Effect.withSpan(effect, name, attributes ? { attributes } : undefined));
}

/** Span-wrap a plain async thunk on a runtime — for imperative (non-Effect)
 *  services that just want a traced boundary around existing async code
 *  without importing Effect themselves. */
export function runTracedPromise<A>(
  runtime: O11yRuntime,
  name: string,
  thunk: () => Promise<A>,
  attributes?: SpanAttributes,
): Promise<A> {
  return runtime.runPromise(
    Effect.withSpan(Effect.promise(thunk), name, attributes ? { attributes } : undefined),
  );
}

/** Fire-and-forget: record a metric (or any unit effect) on the runtime
 *  without awaiting. For incrementing counters from imperative code. */
export function record(runtime: O11yRuntime, effect: Effect.Effect<unknown>): void {
  void runtime.runPromise(effect).catch(() => {});
}
