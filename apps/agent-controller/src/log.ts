import { ___CreateLogger, type Logger } from "@opencrane/backend/observability";

/** Process-wide structured logger for the agent controller, the only process that mutates agent workloads. */
export const _log: Logger = ___CreateLogger("agent-controller");
