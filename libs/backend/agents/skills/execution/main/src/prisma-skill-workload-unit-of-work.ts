import { type PrismaClient } from "@prisma/client";

import { PrismaSkillAuthoringCompletionRepository } from "./prisma-skill-authoring-completion-repository.js";
import { PrismaSkillAuthoringInputRepository } from "./prisma-skill-authoring-input-repository.js";
import { PrismaSkillWorkloadBootstrapRepository } from "./prisma-skill-workload-bootstrap-repository.js";
import { PrismaSkillWorkloadAssignmentRepository } from "./prisma-skill-workload-assignment-repository.js";
import { PrismaSkillWorkloadReleaseRepository } from "./prisma-skill-workload-release-repository.js";
import type { SkillWorkloadExecutionTransaction, SkillWorkloadExecutionUnitOfWork, SkillWorkloadExecutionWork } from "./skill-workload-unit-of-work.types.js";

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
		return this.prisma.$transaction(async function _RunTransaction(transaction): Promise<Result>
		{
			// 1. Bind every persistence capability to the same transaction so none can open an independent commit.
			const assignmentPersistence = new PrismaSkillWorkloadAssignmentRepository(transaction);
			const releasePersistence = new PrismaSkillWorkloadReleaseRepository(transaction);
			const repositories: SkillWorkloadExecutionTransaction = {
				assignments: {
					claimNext(): ReturnType<typeof assignmentPersistence.claimNext> { return assignmentPersistence.claimNext(claimLeaseMilliseconds); },
					commitAssignment(workloadId, command): ReturnType<typeof assignmentPersistence.commitAssignment> { return assignmentPersistence.commitAssignment(workloadId, command, claimLeaseMilliseconds); },
				},
				releases: {
					claimNextRelease(): ReturnType<typeof releasePersistence.claimNextRelease> { return releasePersistence.claimNextRelease(claimLeaseMilliseconds); },
					commitRelease(workloadId, command): ReturnType<typeof releasePersistence.commitRelease> { return releasePersistence.commitRelease(workloadId, command); },
					registerFirstPod(workloadId, command): ReturnType<typeof releasePersistence.registerFirstPod> { return releasePersistence.registerFirstPod(workloadId, command); },
				},
				bootstraps: new PrismaSkillWorkloadBootstrapRepository(transaction),
				authoringCompletions: new PrismaSkillAuthoringCompletionRepository(transaction),
				authoringInputs: new PrismaSkillAuthoringInputRepository(transaction),
			};

			// 2. Keep the transaction lifetime limited to durable authority work; callers perform external I/O afterwards.
			return work(repositories);
		});
	}
}
