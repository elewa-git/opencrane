import { ___CreateLogger, type Logger } from "@opencrane/backend/observability";

/** Process-wide structured logger for the artifact-service process, which owns the canonical artifact bytes. */
export const _log: Logger = ___CreateLogger("artifact-service");
