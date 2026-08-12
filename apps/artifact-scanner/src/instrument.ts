/** OpenTelemetry bootstrap loaded before scanner transport modules. */
import { ___StartTelemetry } from "@opencrane/backend/observability/telemetry";

await ___StartTelemetry({ serviceName: "artifact-scanner", serviceVersion: process.env["npm_package_version"] ?? "0.8.0" });
