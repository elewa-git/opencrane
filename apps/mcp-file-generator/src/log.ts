import { ___CreateLogger, type Logger } from "@opencrane/backend/observability";

/** Process-wide structured logger for the CSV MCP server. */
export const _log: Logger = ___CreateLogger("mcp-file-generator");
