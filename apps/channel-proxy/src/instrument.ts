/**
 * OpenTelemetry bootstrap for the channel trust boundary.
 *
 * Imported first by the process entry point so HTTP and fetch instrumentation is active before
 * the channel server and authority clients load.
 */
import { ___StartTelemetry } from "@opencrane/backend/observability/telemetry";

await ___StartTelemetry({ serviceName: "channel-proxy", serviceVersion: process.env["npm_package_version"] ?? "0.1.0" });
