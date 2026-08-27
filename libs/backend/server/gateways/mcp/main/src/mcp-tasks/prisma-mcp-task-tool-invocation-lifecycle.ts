import { McpTaskState, Prisma } from "@prisma/client";

import type { McpTaskToolInvocationLifecycleParticipant, ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import type { JsonValue } from "@opencrane/util";

/** Projects task-owned ToolInvocation fences into the caller-visible task in the same transaction. */
export class PrismaMcpTaskToolInvocationLifecycleRepository implements McpTaskToolInvocationLifecycleParticipant
{
	/** Transaction already owned by the MCP runtime unit of work. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind task projections to the MCP runtime transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Mark the exact queued task running when provider dispatch becomes fenced. */
	async markClaimed(invocation: ToolInvocationRecord, _now: Date): Promise<boolean>
	{
		if (invocation.mcpTaskId === null)
			return false;
		const updated = await this._transaction.mcpTask.updateMany({ where: { id: invocation.mcpTaskId, toolInvocation: { is: { id: invocation.id } }, state: McpTaskState.Queued }, data: { state: McpTaskState.Running } });
		return updated.count === 1;
	}

	/** Save the checked MCP result only for the matching running task. */
	async completeSucceeded(invocation: ToolInvocationRecord, result: JsonValue, now: Date): Promise<boolean>
	{
		if (invocation.mcpTaskId === null)
			return false;
		const updated = await this._transaction.mcpTask.updateMany({ where: { id: invocation.mcpTaskId, toolInvocation: { is: { id: invocation.id } }, state: McpTaskState.Running }, data: { state: McpTaskState.Completed, result: result === null ? Prisma.JsonNull : result as Prisma.InputJsonValue, failureCode: null, completedAt: now } });
		return updated.count === 1;
	}

	/** Save a bounded definite failure only for the matching running task. */
	async completeFailed(invocation: ToolInvocationRecord, failureCode: string, now: Date): Promise<boolean>
	{
		if (invocation.mcpTaskId === null)
			return false;
		const updated = await this._transaction.mcpTask.updateMany({ where: { id: invocation.mcpTaskId, toolInvocation: { is: { id: invocation.id } }, state: McpTaskState.Running }, data: { state: McpTaskState.Failed, result: Prisma.DbNull, failureCode, completedAt: now } });
		return updated.count === 1;
	}

	/** Save manual recovery rather than pretending an uncertain provider effect was cancelled or failed. */
	async completeAmbiguous(invocation: ToolInvocationRecord, now: Date): Promise<boolean>
	{
		if (invocation.mcpTaskId === null)
			return false;
		const updated = await this._transaction.mcpTask.updateMany({ where: { id: invocation.mcpTaskId, toolInvocation: { is: { id: invocation.id } }, state: McpTaskState.Running }, data: { state: McpTaskState.RecoveryRequired, result: Prisma.DbNull, failureCode: "provider_outcome_ambiguous", completedAt: now } });
		return updated.count === 1;
	}
}
