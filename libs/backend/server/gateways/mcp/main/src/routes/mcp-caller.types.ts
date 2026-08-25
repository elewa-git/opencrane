import type { Request } from "express";

import type { McpOperatorCaller } from "../core/mcp-operator.logic.types";

/** Resolves one request to the durable MCP caller that may use a caller-owned endpoint. */
export type McpCallerResolver = (request: Request) => Promise<McpOperatorCaller | null>;
