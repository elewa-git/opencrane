/** OpenTelemetry bootstrap for the private memory gateway. */
import { ___StartTelemetry } from "@opencrane/observability/telemetry";

await ___StartTelemetry({ serviceName: "memory-gateway", serviceVersion: process.env["npm_package_version"] ?? "0.1.0" });
