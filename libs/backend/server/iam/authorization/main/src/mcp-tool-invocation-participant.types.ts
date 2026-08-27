import type { JsonValue } from "@opencrane/util";

import type { ToolInvocationClaim, ToolInvocationClaimResult, ToolInvocationCompletionResult, ToolInvocationRecord } from "./tool-invocation.types";

/**
 * Moves an MCP tool call while another package owns the open database transaction.
 *
 * The MCP runtime uses this port when it must change its command row and the existing
 * `ToolInvocation` row together. The participant keeps arguments, provider claims, results,
 * AgentRun deliveries, lifecycle events, and recovery events inside the authorization package.
 * Task-owned invocations update their MCP task instead of creating an AgentRun delivery. Callers
 * must not keep an instance after the transaction ends.
 *
 * Called by: the OCI MCP runtime authority in
 * libs/backend/server/gateways/mcp/main/src/runtime.
 */
export interface McpToolInvocationTransactionParticipant
{
	/** Return the saved invocation without copying its arguments into MCP-owned storage. */
	findById(invocationId: string): Promise<ToolInvocationRecord | null>;
	/** Claim the provider dispatch and return the fence that the MCP command must save atomically. */
	claim(invocationId: string, now: Date, leaseMilliseconds: number): Promise<ToolInvocationClaimResult>;
	/** Save a checked result and update either its MCP task or its AgentRun delivery and event. */
	completeSucceeded(claim: ToolInvocationClaim, result: JsonValue, now: Date): Promise<ToolInvocationCompletionResult>;
	/** Save a definite failure and update either its MCP task or its AgentRun delivery and event. */
	completeFailed(claim: ToolInvocationClaim, failureCode: string, now: Date): Promise<ToolInvocationCompletionResult>;
	/** Move an uncertain provider outcome into the existing recovery flow in the caller's transaction. */
	completeAmbiguous(claim: ToolInvocationClaim, now: Date): Promise<ToolInvocationRecord | null>;
}

/** MCP-task lifecycle writes that share the ToolInvocation transaction without entering AgentRun state. */
export interface McpTaskToolInvocationLifecycleParticipant
{
	/** Move the exact queued task to running when its provider claim commits. */
	markClaimed(invocation: ToolInvocationRecord, now: Date): Promise<boolean>;
	/** Save the checked task result with the successful ToolInvocation transition. */
	completeSucceeded(invocation: ToolInvocationRecord, result: JsonValue, now: Date): Promise<boolean>;
	/** Save the bounded task failure with the failed ToolInvocation transition. */
	completeFailed(invocation: ToolInvocationRecord, failureCode: string, now: Date): Promise<boolean>;
	/** Make an uncertain task outcome visible as manual recovery required. */
	completeAmbiguous(invocation: ToolInvocationRecord, now: Date): Promise<boolean>;
}

/**
 * Builds an authorization-owned MCP participant against a transaction another package opened.
 *
 * Called by: the Prisma MCP runtime unit of work. Each returned participant is valid for that
 * transaction callback only and must never be cached by a router or worker.
 */
export interface McpToolInvocationTransactionParticipantFactory
{
	/** Bind the authorization operations and event writers to the supplied Prisma transaction. */
	__ForTransaction(transaction: unknown, mcpTasks?: McpTaskToolInvocationLifecycleParticipant): McpToolInvocationTransactionParticipant;
}
