/**
 * OpenTelemetry bootstrap for the OpenCrane server.
 *
 * Imported as the first dependency of `index.ts` so the SDK patches
 * `http`/`express`/`pg`/`fetch` before the rest of the server graph is evaluated.
 * Keep this module tiny and dependency-light for that reason.
 */
import { ___StartTelemetry } from "@opencrane/observability/telemetry";

await ___StartTelemetry({ serviceName: "opencrane-server", serviceVersion: process.env["npm_package_version"] ?? "0.1.0" });
