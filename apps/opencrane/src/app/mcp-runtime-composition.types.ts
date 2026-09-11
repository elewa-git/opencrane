import type { Router } from "express";

import type { McpRuntimeAuthority, McpTaskWorkflow } from "@opencrane/backend/server/gateways/mcp";
import type { ConversationToolProposalRuntimeAdmission } from "@opencrane/backend/server/conversations";

/** Product-facing MCP authority that does not assume a workload realization. */
export interface PublicMcpRuntimeComposition
{
	/** Durable class-specific MCP execution authority shared by the app's controller and companion routes. */
	readonly authority: McpRuntimeAuthority;
	/** Admit executor work inside the conversation proposal's existing transaction. */
	readonly admitToolInvocationInTransaction: ConversationToolProposalRuntimeAdmission;
	/** Browser administrator route that starts immutable-image discovery. */
	readonly promotion: Router;
	/** Durable workflow used by the authenticated public MCP task routes. */
	readonly taskWorkflow: McpTaskWorkflow;
}

/** Production MCP authority plus its Kubernetes workload adapters. */
export interface McpRuntimeComposition extends PublicMcpRuntimeComposition
{
	/** Agent-controller routes that assign and release executor Jobs. */
	readonly controller: Router;
	/** Pod-bound companion routes that claim commands and save results. */
	readonly companion: Router;
}
