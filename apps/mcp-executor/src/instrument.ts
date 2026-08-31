/** OpenTelemetry bootstrap loaded before companion transport modules. */
import { ___StartTelemetry } from "@opencrane/backend/observability/telemetry";

await ___StartTelemetry({ serviceName: "mcp-executor", serviceVersion: process.env["npm_package_version"] ?? "0.10.0" });
