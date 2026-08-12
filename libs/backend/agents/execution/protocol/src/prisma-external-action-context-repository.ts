import type { Prisma, PrismaClient } from "@prisma/client";

import type { ExternalActionExecutionContext, ExternalActionExecutionContextRepository, ExternalActionExecutionContextUnitOfWork } from "./external-action-worker.types.js";
import { __ProjectRuntimeInputSnapshot } from "./runtime-input-snapshot-projector.js";

/** Prisma repository that reloads the immutable snapshot for one current run attempt. */
export class PrismaExternalActionExecutionContextRepository implements ExternalActionExecutionContextRepository
{
	/** Canonical OpenCrane product-authority database client. */
	private readonly transaction: Prisma.TransactionClient;

	/** Create a context repository over process-owned persistence. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Load the snapshot only while the invocation attempt is still the run's current fence. */
	async load(runId: string, attempt: number): Promise<ExternalActionExecutionContext | null>
	{
		const run = await this.transaction.agentRun.findUnique({ where: { id: runId }, include: { inputSnapshot: true } });
		if (run === null || run.attempt !== attempt || run.inputSnapshot === null) return null;
		return { snapshot: __ProjectRuntimeInputSnapshot(run.inputSnapshot) };
	}
}

/** Prisma unit of work that gives one context read a consistent database snapshot. */
export class PrismaExternalActionExecutionContextUnitOfWork implements ExternalActionExecutionContextUnitOfWork
{
	/** Canonical OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;

	/** Create the unit of work over process-owned persistence. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Load one immutable context through a transaction-bound repository. */
	async load(runId: string, attempt: number): Promise<ExternalActionExecutionContext | null>
	{
		return this.prisma.$transaction(async function _load(transaction)
		{
			return new PrismaExternalActionExecutionContextRepository(transaction).load(runId, attempt);
		});
	}
}
