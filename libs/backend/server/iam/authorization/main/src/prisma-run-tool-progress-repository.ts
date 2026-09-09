import { ToolInvocationState, type Prisma } from "@prisma/client";

import { RunToolProgressPhases, type RunToolProgress } from "@opencrane/contracts";

import type { ReadRunToolProgressCommand, RunToolProgressRepository } from "./run-tool-progress.types";

/** Maps every persisted invocation state to a truthful public phase without provider detail. */
const _PHASES: Readonly<Record<ToolInvocationState, RunToolProgressPhases>> = {
	[ToolInvocationState.Preparing]: RunToolProgressPhases.Queued,
	[ToolInvocationState.Ready]: RunToolProgressPhases.Queued,
	[ToolInvocationState.Claimed]: RunToolProgressPhases.Running,
	[ToolInvocationState.Reconciling]: RunToolProgressPhases.Running,
	[ToolInvocationState.Succeeded]: RunToolProgressPhases.ResultReceived,
	[ToolInvocationState.AwaitingApproval]: RunToolProgressPhases.NeedsAttention,
	[ToolInvocationState.Failed]: RunToolProgressPhases.NeedsAttention,
	[ToolInvocationState.RecoveryRequired]: RunToolProgressPhases.NeedsAttention,
};

/**
 * Projects the latest run-owned invocation without loading its arguments, result or execution identity.
 *
 * Called by: __ReadRunToolProgressInTransaction after the caller has authorized the exact run in
 * the same transaction. This repository supplies no permission and never acknowledges a result.
 * @see ReadRunToolProgressCommand for the trusted run and current-attempt coordinates.
 */
export class PrismaRunToolProgressRepository implements RunToolProgressRepository
{
	/** Keeps the state read in the snapshot that owns the caller's current Read authorization. */
	private readonly transaction: Prisma.TransactionClient;

	/** Receives the exact caller transaction before the package helper reads progress. */
	public constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Keeps the concrete repository behind IAM's transaction helper. */
	public static inTransaction(transaction: Prisma.TransactionClient): RunToolProgressRepository
	{
		return new PrismaRunToolProgressRepository(transaction);
	}

	/** Returns only the latest phase; invalid coordinates, unknown state and database failures remain errors. */
	public async readLatest(command: ReadRunToolProgressCommand): Promise<RunToolProgress | null>
	{
		if (typeof command.siloId !== "string" || !command.siloId.trim() || command.siloId !== command.siloId.trim()
			|| typeof command.runId !== "string" || !command.runId.trim() || command.runId !== command.runId.trim()
			|| !Number.isSafeInteger(command.attempt) || command.attempt < 1)
			throw new Error("Run tool progress coordinates are invalid");
		const row = await this.transaction.toolInvocation.findFirst({ where: { siloId: command.siloId, runId: command.runId, attempt: command.attempt, mcpTaskId: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { state: true } });
		if (row === null)
			return null;
		const phase = _PHASES[row.state];
		if (!Object.values(RunToolProgressPhases).includes(phase))
			throw new Error("Run tool progress state is invalid");
		return { phase };
	}
}
