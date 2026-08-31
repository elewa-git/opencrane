import type { Request } from "express";

import type { McpTaskCaller } from "../mcp-tasks/mcp-task.types";

/** Resolves authenticated browser evidence into the durable local MCP caller. */
export type McpCallerResolver = (request: Request) => Promise<McpTaskCaller | null>;
