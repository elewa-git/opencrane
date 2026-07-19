import { ___StartTelemetry } from "@opencrane/observability/telemetry";

await ___StartTelemetry({ serviceName: "agent-controller", serviceVersion: process.env["npm_package_version"] ?? "0.1.0" });
