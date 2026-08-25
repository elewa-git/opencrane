import type { Prisma, PrismaClient } from "@prisma/client";

import type { ExternalActionExecutionContext, ExternalActionExecutionContextRepository, ExternalActionExecutionContextUnitOfWork } from "./external-action-worker.types";
import { __ProjectRuntimeInputSnapshot } from "./runtime-input-snapshot-projector";

/**
 * Loads the immutable snapshot for a run, but only while that attempt is still the current one.
 *
 * The attempt check is the point: an invocation belonging to an attempt the run has moved past must
 * not be given a snapshot to work from, because its result could never be delivered. Returning null
 * is how that work is stopped.
 *
 * Called by: `PrismaExternalActionExecutionContextUnitOfWork.load`, and through it the external
 * action worker's `_rebuildAdapter` and `_openApproval`.
 *
 * @implements ExternalActionExecutionContextRepository
 */
export class PrismaExternalActionExecutionContextRepository implements ExternalActionExecutionContextRepository
{
	/** The transaction the snapshot is read on. */
	private readonly transaction: Prisma.TransactionClient;

	/** Create the repository over the caller's transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/**
	 * Load the snapshot only while the run is still on this attempt.
	 *
	 * @param runId - Run that owns the invocation.
	 * @param attempt - Attempt the invocation was admitted under.
	 * @returns The frozen snapshot, or null when the run has moved to another attempt or has no
	 * snapshot row. Null obliges the caller to stop the invocation rather than retry it.
	 */
	async load(runId: string, attempt: number): Promise<ExternalActionExecutionContext | null>
	{
		const run = await this.transaction.agentRun.findUnique({ where: { id: runId }, include: { inputSnapshot: true } });
		if (run === null || run.attempt !== attempt || run.inputSnapshot === null) return null;
		return { snapshot: __ProjectRuntimeInputSnapshot(run.inputSnapshot) };
	}
}

/**
 * Runs one snapshot read in its own transaction, so the whole read sees the same data.
 *
 * Called by: apps/opencrane/src/app/external-action-composition.ts constructs it as the worker's
 * `contexts` port.
 *
 * @implements ExternalActionExecutionContextUnitOfWork
 */
export class PrismaExternalActionExecutionContextUnitOfWork implements ExternalActionExecutionContextUnitOfWork
{
	/** The transaction the snapshot is read on. */
	private readonly prisma: PrismaClient;

	/** Create the unit of work over the process's Prisma client. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Load one immutable context through a transaction-bound repository. */
	async load(runId: string, attempt: number): Promise<ExternalActionExecutionContext | null>
	{
		return this.prisma.$transaction(async function _load(transaction)
		{
			const repository = new PrismaExternalActionExecutionContextRepository(transaction);
			return repository.load(runId, attempt);
		});
	}
}
