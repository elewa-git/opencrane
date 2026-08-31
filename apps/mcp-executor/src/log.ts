import { ___CreateLogger, type Logger } from "@opencrane/backend/observability";

/** Process-wide structured logger for the one-shot MCP companion. */
export const _log: Logger = ___CreateLogger("mcp-executor");
