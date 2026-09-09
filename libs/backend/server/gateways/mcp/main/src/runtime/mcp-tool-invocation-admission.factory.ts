import type { Prisma } from "@prisma/client";

import type { McpToolInvocationTransactionParticipantFactory } from "@opencrane/backend/server/iam/authorization";

import type { McpRuntimeAuthorityOptions, McpToolInvocationAdmission } from "./mcp-runtime.types";
import { PrismaMcpToolInvocationAdmissionRepository } from "./prisma-mcp-tool-invocation-admission-repository";

/**
 * Bind MCP admission to the caller's proposal transaction.
 *
 * Creating executor work and accepting the proposal must commit together. The caller supplies its
 * transaction; this adapter never opens another one or dispatches a provider request.
 */
export function _CreateMcpToolInvocationAdmission(participants: McpToolInvocationTransactionParticipantFactory, options: McpRuntimeAuthorityOptions): McpToolInvocationAdmission
{
	return async function _AdmitInTransaction(transaction, invocationRowId): Promise<boolean>
	{
		const repository = new PrismaMcpToolInvocationAdmissionRepository(transaction as Prisma.TransactionClient, participants.__ForTransaction(transaction), options);
		const result = await repository.admitInvocation(invocationRowId);
		return result === "admitted" || result === "idempotent";
	};
}
