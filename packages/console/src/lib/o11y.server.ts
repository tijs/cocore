// Console-side observability boundary.
//
// One telemetry runtime for the whole console server process. Server fns,
// middleware, and route handlers run their effects through `runTraced`,
// which wraps each operation in a root span and (when OTLP is configured)
// exports traces + metrics + logs to Honeycomb. A no-op until
// OTEL_EXPORTER_OTLP_* is set — see @cocore/o11y.
//
// This is `.server.ts` so the runtime (and the OTel SDK it pulls in)
// never reaches the client bundle.

import { makeRuntime, runTraced as runTracedWith, type SpanAttributes } from "@cocore/o11y";
import type { Effect } from "effect";

import { AppviewClient } from "@/integrations/appview/appview.server.ts";

/** The console's application services, provided by the single runtime. New
 *  Effect services (PDS write, OAuth store, …) get merged in here. */
const AppLayer = AppviewClient.Default;

/** Requirements the runtime satisfies — the union of `AppLayer`'s services.
 *  Effects passed to {@link runTraced} may require any subset of these. */
type AppEnv = AppviewClient;

const runtime = makeRuntime(
  {
    serviceName: process.env["OTEL_SERVICE_NAME"] ?? "cocore-console",
    serviceVersion: process.env["COCORE_SOFTWARE_VERSION"],
  },
  AppLayer,
);

/** Run a server-side effect wrapped in a root span named for the
 *  operation. Drop-in replacement for `Effect.runPromise(effect)`; the
 *  effect may require any service the runtime provides ({@link AppEnv}). */
export function runTraced<A, E>(
  name: string,
  effect: Effect.Effect<A, E, AppEnv>,
  attributes?: SpanAttributes,
): Promise<A> {
  return runTracedWith(runtime, name, effect, attributes);
}
