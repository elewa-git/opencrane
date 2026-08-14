import { Prisma, type PrismaClient } from "@prisma/client";

import { PrismaSkillAuthoringCompletionRepository } from "./prisma-skill-authoring-completion-repository";
import { PrismaSkillAuthoringInputRepository } from "./prisma-skill-authoring-input-repository";
import { PrismaSkillWorkloadBootstrapRepository } from "./prisma-skill-workload-bootstrap-repository";
import { PrismaSkillWorkloadAssignmentRepository } from "./prisma-skill-workload-assignment-repository";
import { PrismaSkillWorkloadReleaseRepository } from "./prisma-skill-workload-release-repository";
import { _SkillWorkloadPersistenceConflictError, type SkillWorkloadExecutionTransaction, type SkillWorkloadExecutionUnitOfWork, type SkillWorkloadExecutionWork } from "./skill-workload-unit-of-work.types";

/** Owns the root PrismaClient and opens every skill-execution transaction. */
export class PrismaSkillWorkloadUnitOfWork implements SkillWorkloadExecutionUnitOfWork
{
	/** The main OpenCrane database client. */
	private readonly prisma: PrismaClient;
	/** How long a controller claim lasts, taken from process configuration. */
	private readonly claimLeaseMilliseconds: number;

	/** Stores the client and claim lease used by every transaction this class opens. */
	constructor(prisma: PrismaClient, claimLeaseMilliseconds: number)
	{
		if (!Number.isSafeInteger(claimLeaseMilliseconds) || claimLeaseMilliseconds < 1 || claimLeaseMilliseconds > 300_000) throw new Error("skill workload claim lease must be bounded");
		this.prisma = prisma;
		this.claimLeaseMilliseconds = claimLeaseMilliseconds;
	}

	/** Opens one short transaction and gives the work only repositories bound to it. */
	async run<Result>(work: SkillWorkloadExecutionWork<Result>): Promise<Result>
	{
		const claimLeaseMilliseconds = this.claimLeaseMilliseconds;
		let finalConflict: Prisma.PrismaClientKnownRequestError | null = null;
		for (let attempt = 1; attempt <= _SERIALIZABLE_ATTEMPTS; attempt += 1)
		{
			try
			{
				return await this.prisma.$transaction(async function _RunTransaction(transaction): Promise<Result>
				{
					// 1. Build every repository on the same transaction, so none of them can commit on its own.
					const repositories: SkillWorkloadExecutionTransaction = {
						assignments: new PrismaSkillWorkloadAssignmentRepository(transaction, claimLeaseMilliseconds),
						releases: new PrismaSkillWorkloadReleaseRepository(transaction, claimLeaseMilliseconds),
						bootstraps: new PrismaSkillWorkloadBootstrapRepository(transaction),
						authoringCompletions: new PrismaSkillAuthoringCompletionRepository(transaction),
						authoringInputs: new PrismaSkillAuthoringInputRepository(transaction),
					};

					// 2. Keep only database work inside the transaction. Callers do network and file I/O after it commits.
					return work(repositories);
				}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			}
			catch (error)
			{
				if (!(error instanceof Prisma.PrismaClientKnownRequestError) || (error.code !== "P2002" && error.code !== "P2034")) throw error;
				if (error.code === "P2002") throw new _SkillWorkloadPersistenceConflictError("skill workload persistence conflict", { cause: error });
				finalConflict = error;
			}
		}
		throw new _SkillWorkloadPersistenceConflictError("skill workload persistence conflict after bounded serializable retries", { cause: finalConflict ?? undefined });
	}
}

/** How many times a serializable transaction is retried when two controllers collide. */
const _SERIALIZABLE_ATTEMPTS = 3;
