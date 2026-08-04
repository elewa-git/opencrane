import { Prisma, type PrismaClient } from "@prisma/client";

import { PrismaSkillAuthoringCompletionRepository } from "./prisma-skill-authoring-completion-repository.js";
import { PrismaSkillAuthoringInputRepository } from "./prisma-skill-authoring-input-repository.js";
import { PrismaSkillWorkloadBootstrapRepository } from "./prisma-skill-workload-bootstrap-repository.js";
import { PrismaSkillWorkloadAssignmentRepository } from "./prisma-skill-workload-assignment-repository.js";
import { PrismaSkillWorkloadReleaseRepository } from "./prisma-skill-workload-release-repository.js";
import { _SkillWorkloadPersistenceConflictError, type SkillWorkloadExecutionTransaction, type SkillWorkloadExecutionUnitOfWork, type SkillWorkloadExecutionWork } from "./skill-workload-unit-of-work.types.js";

/** Sole root PrismaClient and transaction owner for governed skill-execution durability. */
export class PrismaSkillWorkloadUnitOfWork implements SkillWorkloadExecutionUnitOfWork
{
	/** Canonical OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;
	/** Bounded controller claim lease supplied by process configuration. */
	private readonly claimLeaseMilliseconds: number;

	/** Creates the sole transaction-opening persistence boundary for skill execution. */
	constructor(prisma: PrismaClient, claimLeaseMilliseconds: number)
	{
		if (!Number.isSafeInteger(claimLeaseMilliseconds) || claimLeaseMilliseconds < 1 || claimLeaseMilliseconds > 300_000) throw new Error("skill workload claim lease must be bounded");
		this.prisma = prisma;
		this.claimLeaseMilliseconds = claimLeaseMilliseconds;
	}

	/** Opens one short-lived transaction and exposes only transaction-scoped capability repositories. */
	async run<Result>(work: SkillWorkloadExecutionWork<Result>): Promise<Result>
	{
		const claimLeaseMilliseconds = this.claimLeaseMilliseconds;
		try
		{
			return await this.prisma.$transaction(async function _RunTransaction(transaction): Promise<Result>
			{
				// 1. Bind every persistence capability to the same transaction so none can open an independent commit.
				const repositories: SkillWorkloadExecutionTransaction = {
					assignments: new PrismaSkillWorkloadAssignmentRepository(transaction, claimLeaseMilliseconds),
					releases: new PrismaSkillWorkloadReleaseRepository(transaction, claimLeaseMilliseconds),
					bootstraps: new PrismaSkillWorkloadBootstrapRepository(transaction),
					authoringCompletions: new PrismaSkillAuthoringCompletionRepository(transaction),
					authoringInputs: new PrismaSkillAuthoringInputRepository(transaction),
				};

				// 2. Keep the transaction lifetime limited to durable authority work; callers perform external I/O afterwards.
				return work(repositories);
			});
		}
		catch (error)
		{
			if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) throw new _SkillWorkloadPersistenceConflictError("skill workload persistence conflict", { cause: error });
			throw error;
		}
	}
}
