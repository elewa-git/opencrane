import { Prisma, type PrismaClient } from "@prisma/client";

import type { McpToolInvocationTransactionParticipantFactory } from "@opencrane/backend/server/iam/authorization";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { McpConnectionExecutionSettlement, McpConnectionRecord } from "../connections/mcp-connection.types";
import { PrismaMcpTaskToolInvocationLifecycleRepository } from "../mcp-tasks/prisma-mcp-task-tool-invocation-lifecycle";
import { PrismaMcpConnectionExecutionSettlementRepository } from "./prisma-mcp-connection-execution-settlement-repository";

/** Owns the transaction that closes unused remote work before Secret cleanup. */
export class PrismaMcpConnectionExecutionSettlementUnitOfWork implements McpConnectionExecutionSettlement
{
	/** Bind settlement to the ToolInvocation participant used by dispatch. */
	constructor(private readonly prisma: PrismaClient, private readonly toolInvocations: McpToolInvocationTransactionParticipantFactory) {}

	/** Close Pending rows, while a Claimed row keeps credential cleanup waiting. */
	isSettled(record: McpConnectionRecord): Promise<boolean>
	{
		const prisma = this.prisma;
		const toolInvocations = this.toolInvocations;
		return ___RunInPrismaUnitOfWork(prisma, async function _SettleConnectionExecutions(transaction): Promise<boolean>
		{
			const tasks = new PrismaMcpTaskToolInvocationLifecycleRepository(transaction);
			const participant = toolInvocations.__ForTransaction(transaction, tasks);
			const repository = new PrismaMcpConnectionExecutionSettlementRepository(transaction);
			return repository.isSettled(record, participant);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, operation: "MCP connection execution settlement", attemptLimit: 3, timeout: 10_000 });
	}
}
