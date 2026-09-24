/** Starts OpenTelemetry before the HTTP server and its instrumented imports load. */
import { ___StartTelemetry } from "@opencrane/backend/observability/telemetry";

await ___StartTelemetry({ serviceName: "mcp-file-generator", serviceVersion: process.env["npm_package_version"] ?? "0.11.0" });
