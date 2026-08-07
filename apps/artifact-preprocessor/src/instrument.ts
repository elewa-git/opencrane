/**
 * OpenTelemetry bootstrap for the isolated PDF preprocessing worker.
 *
 * Imported first by the process entry point so HTTP calls and child-process work are traceable.
 */
import { ___StartTelemetry } from "@opencrane/backend/observability/telemetry";

await ___StartTelemetry({ serviceName: "artifact-preprocessor", serviceVersion: process.env["npm_package_version"] ?? "0.1.0" });
