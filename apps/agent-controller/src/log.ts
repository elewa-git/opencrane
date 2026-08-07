import { ___CreateLogger, type Logger } from "@opencrane/backend/observability";

/** Process-wide structured logger for the agent-workload mutation boundary. */
export const _log: Logger = ___CreateLogger("agent-controller");
