/**
 * OpenTelemetry bootstrap for the canonical artifact-byte boundary.
 *
 * Imported first by the process entry point so the mounted-volume preparation and HTTP listener
 * are covered before application modules load.
 */
import { ___StartTelemetry } from "@opencrane/observability/telemetry";

await ___StartTelemetry({ serviceName: "artifact-service", serviceVersion: process.env["npm_package_version"] ?? "0.1.0" });
