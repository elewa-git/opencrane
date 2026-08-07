/**
 * OpenTelemetry bootstrap for the sole agent-workload Kubernetes mutator.
 *
 * Imported first so fetch and Kubernetes HTTP calls are instrumented before their modules load.
 */
import { ___StartTelemetry } from "@opencrane/backend/observability/telemetry";

await ___StartTelemetry({ serviceName: "agent-controller", serviceVersion: process.env["npm_package_version"] ?? "0.1.0" });
