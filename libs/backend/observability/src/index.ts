/**
 * @opencrane/backend/observability — centralized structured logging + execution tracing.
 *
 * One place to build a fleet-consistent logger, propagate a correlation id
 * through async work without threading it by hand, route stray `console.*`
 * calls into structured logs, and emit OpenTelemetry traces over OTLP to an
 * operator-owned endpoint when configured.
 *
 * The side-effecting SDK bootstrap ({@link ___StartTelemetry}) is also available
 * via the dedicated `@opencrane/backend/observability/telemetry` entry point so it can
 * be imported in isolation before the rest of the application graph.
 */
export { ___CreateLogger } from "./logger";
export type { Logger } from "./logger";
export { ___RunWithContext, ___GetContext, ___SetContextField, ___ContextMixin } from "./context";
export { ___BindConsole } from "./console-bind";
export { ___RequestContext } from "./express";
export { ___DoWithTrace, ___DoWithoutTrace, ___GetActiveSpan, ___MarkActiveSpanFailed } from "./operation";
export { ___StartTelemetry, ___ShutdownTelemetry } from "./telemetry";
export type { RequestContext, LoggerOptions, TelemetryOptions } from "./observability.types";
