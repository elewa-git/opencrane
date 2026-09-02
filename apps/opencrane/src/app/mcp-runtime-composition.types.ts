import type { Router } from "express";

import type { McpRuntimeAuthority, McpTaskWorkflow } from "@opencrane/backend/server/gateways/mcp";

/** One process-owned OCI MCP authority and its three authenticated HTTP adapters. */
export interface McpRuntimeComposition
{
	/** Durable class-specific MCP execution authority shared by the app's controller and companion routes. */
	readonly authority: McpRuntimeAuthority;
	/** Browser administrator route that starts immutable-image discovery. */
	readonly promotion: Router;
	/** Agent-controller routes that assign and release executor Jobs. */
	readonly controller: Router;
	/** Pod-bound companion routes that claim commands and save results. */
	readonly companion: Router;
	/** Durable workflow used by the authenticated public MCP task routes. */
	readonly taskWorkflow: McpTaskWorkflow;
}
