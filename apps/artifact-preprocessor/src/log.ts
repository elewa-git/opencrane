import { ___CreateLogger, type Logger } from "@opencrane/backend/observability";

/** Process-wide structured logger for the outbound-only PDF preprocessing boundary. */
export const _log: Logger = ___CreateLogger("artifact-preprocessor");
