// The one place OpenTelemetry is configured for the TypeScript services.
//
// Everything routes through `@effect/opentelemetry`'s NodeSdk layer: a
// single layer wires traces (span processor), metrics (Effect `Metric`
// → OTLP), and the Effect → OTel log bridge (log record processor) at
// once. See `metrics.ts` for the shared instruments and `runtime.ts`
// for how a service obtains a runtime that provides this layer.
//
// Honeycomb is OTLP-native, so there is no Honeycomb-specific code here:
// point `OTEL_EXPORTER_OTLP_ENDPOINT` at `https://api.honeycomb.io` and
// pass the team key in `OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=...`.
//
// Gating: until an OTLP endpoint is configured this is a no-op. We build
// no exporter and provide `Layer.empty`, so `Effect.withSpan` degrades to
// the default no-op tracer and `Metric`/log emission stay in-process.
// Local dev and CI therefore behave exactly as they did before o11y.
//
// Privacy invariant (mirrors the Rust agent — see
// provider/src/diagnostics.rs): spans/metrics/logs carry IDs, DIDs,
// sizes, hashes, counts, and durations — never prompt/output bytes,
// plaintext, secrets, or API keys.

import { NodeSdk } from "@effect/opentelemetry";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";

export interface O11yConfig {
  /** Logical service name. Overridden by `OTEL_SERVICE_NAME` when set so
   *  operators can follow the standard OTel knobs. */
  serviceName: string;
  /** Optional service version (e.g. a build tag). Falls back to
   *  `OTEL_SERVICE_VERSION` when unset. */
  serviceVersion?: string;
}

/** True when an OTLP endpoint is configured. When false, telemetry is a
 *  no-op and no exporter is constructed. Honors both the generic endpoint
 *  and the signal-specific traces endpoint, matching the OTel SDK's own
 *  precedence. */
export function otlpEnabled(): boolean {
  return Boolean(
    process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] ?? process.env["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"],
  );
}

/** The NodeSdk layer wiring traces + metrics + logs to OTLP. Only call
 *  when {@link otlpEnabled} is true — it constructs live exporters. The
 *  OTLP exporters read endpoint/headers/protocol from the standard
 *  `OTEL_EXPORTER_OTLP_*` env vars, so we pass no URLs here. */
export function sdkLayer(config: O11yConfig) {
  const serviceName = process.env["OTEL_SERVICE_NAME"] ?? config.serviceName;
  const serviceVersion = config.serviceVersion ?? process.env["OTEL_SERVICE_VERSION"] ?? undefined;
  return NodeSdk.layer(() => ({
    resource: { serviceName, ...(serviceVersion ? { serviceVersion } : {}) },
    spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter()),
    metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() }),
    logRecordProcessor: new BatchLogRecordProcessor(new OTLPLogExporter()),
  }));
}
