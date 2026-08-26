import type { JsonValue } from "@opencrane/util";

import type { ToolInvocationClaim, ToolInvocationClaimResult, ToolInvocationCompletionResult, ToolInvocationRecord } from "./tool-invocation.types";

/**
 * Moves an MCP tool call while another package owns the open database transaction.
 *
 * The MCP runtime uses this port when it must change its command row and the existing
 * `ToolInvocation` row together. The participant keeps arguments, provider claims, results,
 * deliveries, lifecycle events, and recovery events inside the authorization package. Callers
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
	/** Save a checked tool result, its delivery, and its lifecycle event in the caller's transaction. */
	completeSucceeded(claim: ToolInvocationClaim, result: JsonValue, now: Date): Promise<ToolInvocationCompletionResult>;
	/** Save a definite tool failure, its delivery, and its lifecycle event in the caller's transaction. */
	completeFailed(claim: ToolInvocationClaim, failureCode: string, now: Date): Promise<ToolInvocationCompletionResult>;
	/** Move an uncertain provider outcome into the existing recovery flow in the caller's transaction. */
	completeAmbiguous(claim: ToolInvocationClaim, now: Date): Promise<ToolInvocationRecord | null>;
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
	__ForTransaction(transaction: unknown): McpToolInvocationTransactionParticipant;
}
