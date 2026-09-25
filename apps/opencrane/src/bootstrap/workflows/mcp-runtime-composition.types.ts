import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";

import type { McpConnectionAuthority, McpRuntimeAuthority, McpTaskWorkflow } from "@opencrane/backend/server/gateways/mcp";
import type { ConversationComputerToolInvocationDispatch, ConversationToolProposalRuntimeAdmission } from "@opencrane/backend/server/conversations";
import type { McpToolInvocationTransactionParticipantFactory } from "@opencrane/backend/server/iam/authorization";

import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import type { OpenCraneProcessConfig } from "../configuration/config.types";
import type { OpenCraneKubernetesClients } from "../process/kubernetes-clients.types";
import type { McpWorkflowComposition } from "./mcp-workflow-composition.types";

/** Supplies the process services and configuration used to execute OCI and remote MCP tool invocations. */
export interface McpExecutionContext
{
	/** Provides database access to invocation, connection and recovery adapters. */
	readonly prisma: PrismaClient;
	/** Supplies workload token review and Pod access for MCP execution. */
	readonly kubernetes: Pick<OpenCraneKubernetesClients, "authApi" | "coreApi">;
	/** Supplies runtime identities, connection settings, timeouts and the private payload keyring path. */
	readonly processConfig: Pick<OpenCraneProcessConfig, "runtime" | "mcpConnections" | "workflows" | "conversationPrivatePayloadKeyringPath">;
	/** Supplies durable task execution, task persistence and the remote MCP client. */
	readonly workflows: McpWorkflowComposition;
	/** Reads current conversation evidence and stores visible tool progress. */
	readonly history: HistoryStore;
}

/** MCP execution authorities and the adapters shared by public tasks and conversation turns. */
export interface McpRuntimeComposition
{
	/** Admits connection changes through current personal or company authority. */
	readonly connections: McpConnectionAuthority;
	/** Lets the turn workflow progress remote calls through the existing invocation authority. */
	readonly toolDispatch: ConversationComputerToolInvocationDispatch;
	/** Durable class-specific MCP execution authority shared by the app's controller and companion routes. */
	readonly authority: McpRuntimeAuthority;
	/** Rebind the same IAM owner when server workflows read a captured invocation after executor exit. */
	readonly invocationParticipants: McpToolInvocationTransactionParticipantFactory;
	/** Admit executor work inside the conversation proposal's existing transaction. */
	readonly admitToolInvocationInTransaction: ConversationToolProposalRuntimeAdmission;
	/** Browser administrator route that starts immutable-image discovery. */
	readonly promotion: Router;
	/** Agent-controller routes that assign and release executor Jobs. */
	readonly controller: Router;
	/** Pod-bound companion routes that claim commands and save results. */
	readonly companion: Router;
	/** Durable workflow used by the authenticated public MCP task routes. */
	readonly taskWorkflow: McpTaskWorkflow;
}
