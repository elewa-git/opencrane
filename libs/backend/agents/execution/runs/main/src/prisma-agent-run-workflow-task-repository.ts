import { type Prisma } from "@prisma/client";

import { AgentRunTaskDeclaration } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import { AgentRunWorkflowAdmissionRejectionReasons, type AgentRunWorkflowAdmissionCommand, type AgentRunWorkflowTaskRecord, type AgentRunWorkflowTaskRepository, type AgentRunWorkflowTaskResolution } from "@opencrane/backend/agents/execution/runs/workflows";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

/** Builds the stable engine idempotency key for one immutable AgentRun attempt. */
function _TaskKey(command: AgentRunWorkflowAdmissionCommand): string
{
	return `agent-run:${command.siloId}:${command.runId}:attempt:${command.attempt}`;
}

/** Maps one persisted task record to the engine-neutral admission contract. */
function _TaskRecord(row: { readonly runId: string; readonly attempt: number; readonly siloId: string; readonly taskKey: string }): AgentRunWorkflowTaskRecord
{
	return { runId: row.runId, attempt: row.attempt, siloId: row.siloId, taskKey: row.taskKey };
}

/**
 * Persists and receipt-binds one controller-owned workflow task for an AgentRun attempt.
 *
 * Called by: {@link PrismaRunAdmissionRepository} and {@link PrismaAgentRunAuthorityRepository}
 * inside their existing database transactions. The adapter keeps task admission alongside the run
 * mutation without owning a transaction or starting a controller handler.
 *
 * @implements AgentRunWorkflowTaskRepository
 */
export class PrismaAgentRunWorkflowTaskRepository implements AgentRunWorkflowTaskRepository
{
	/** Transaction shared with the AgentRun write and Absurd task admission. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates one task-record adapter over an already-open AgentRun transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Creates or reuses the exact task record only while the named attempt is current. */
	async createOrFind(command: AgentRunWorkflowAdmissionCommand): Promise<AgentRunWorkflowTaskResolution>
	{
		const run = await this.transaction.agentRun.findUnique({ where: { id: command.runId }, select: { siloId: true, attempt: true } });
		if (run === null || run.siloId !== command.siloId)
		{
			return { rejectionReason: AgentRunWorkflowAdmissionRejectionReasons.ForeignSilo };
		}
		if (run.attempt !== command.attempt)
		{
			return { rejectionReason: AgentRunWorkflowAdmissionRejectionReasons.StaleAttempt };
		}

		const taskKey = _TaskKey(command);
		const record = await this.transaction.agentRunWorkflowTask.upsert({
			where: { runId_attempt: { runId: command.runId, attempt: command.attempt } },
			create: { runId: command.runId, attempt: command.attempt, siloId: command.siloId, taskKey, taskName: AgentRunTaskDeclaration.taskName },
			update: {},
			select: { runId: true, attempt: true, siloId: true, taskKey: true, taskName: true },
		});
		if (record.siloId !== command.siloId || record.taskKey !== taskKey || record.taskName !== AgentRunTaskDeclaration.taskName)
		{
			return { rejectionReason: AgentRunWorkflowAdmissionRejectionReasons.ConflictingTask };
		}
		return { record: _TaskRecord(record) };
	}

	/** Binds an Absurd receipt once, or proves an exact retry already bound it. */
	async bindTask(record: AgentRunWorkflowTaskRecord, receipt: IWorkflowTaskReceipt): Promise<"bound" | "idempotent" | "conflict">
	{
		const bound = await this.transaction.agentRunWorkflowTask.updateMany({
			where: { runId: record.runId, attempt: record.attempt, siloId: record.siloId, taskKey: record.taskKey, taskName: receipt.taskName, taskId: null },
			data: { taskId: receipt.taskId, receiptBoundAt: new Date() },
		});
		if (bound.count === 1)
		{
			return "bound";
		}
		const saved = await this.transaction.agentRunWorkflowTask.findUnique({ where: { runId_attempt: { runId: record.runId, attempt: record.attempt } }, select: { siloId: true, taskKey: true, taskName: true, taskId: true } });
		if (saved?.siloId === record.siloId && saved.taskKey === record.taskKey && saved.taskName === receipt.taskName && saved.taskId === receipt.taskId)
		{
			return "idempotent";
		}
		return "conflict";
	}
}
