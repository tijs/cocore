// @cocore/o11y — OpenTelemetry (traces + metrics + logs) for the cocore
// TypeScript services, exported to Honeycomb via OTLP. A no-op until
// OTEL_EXPORTER_OTLP_* is set. See tracing.ts for the design.

export { otlpEnabled, sdkLayer, type O11yConfig } from "./tracing.ts";
export { makeRuntime, runTraced, type O11yRuntime, type SpanAttributes } from "./runtime.ts";
export { logError, logInfo, logWarn, type LogFields } from "./log.ts";
export * as metrics from "./metrics.ts";
