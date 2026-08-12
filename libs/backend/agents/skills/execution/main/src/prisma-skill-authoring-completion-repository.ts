import { Prisma, SkillRevisionState, SkillWorkloadKind, SkillWorkloadState } from "@prisma/client";

import { SkillAuthoringCompletionOutcomes, type SkillAuthoringCompletionCommand } from "./skill-authoring-completion.types.js";
import type { SkillWorkloadBootstrapIdentity } from "./skill-workload-bootstrap.types.js";
import { _SkillWorkloadTimestampProposal } from "./prisma-skill-workload-timestamps.js";
import { _SkillWorkloadPersistenceConflictError, type SkillAuthoringCompletionRepository } from "./skill-workload-unit-of-work.types.js";

/** Stores an authoring worker's final report and moves the workload to its final state. */
export class PrismaSkillAuthoringCompletionRepository implements SkillAuthoringCompletionRepository
{
	/** Prisma client for this transaction. Only the unit of work supplies it. */
	private readonly transaction: Prisma.TransactionClient;

	/** Stores the transaction this repository reads and writes through. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Completes one authoring workload whose worker already consumed its bootstrap, storing only the two fixed reports. */
	async complete(command: SkillAuthoringCompletionCommand, identity: SkillWorkloadBootstrapIdentity): Promise<"completed" | "conflict">
	{
		// 1. Re-read the workload, its bootstrap, and its revision in this transaction, and require every id to match.
		const workload = await this.transaction.skillWorkload.findFirst({ where: { id: command.workloadId, kind: SkillWorkloadKind.Authoring, state: SkillWorkloadState.Assigned, releasedAt: { not: null }, workerPodUid: identity.podUid, bootstrap: { is: { consumedAt: { not: null }, consumedByPodUid: identity.podUid, namespace: identity.namespace, serviceAccountName: identity.serviceAccountName } } }, include: { skillRevision: true } });
		if (workload === null || workload.skillRevision.state !== SkillRevisionState.Draft) return "conflict";

		// 2. Write the passing reports before moving the workload to its final state. A failure stores only the failure code.
		if (command.outcome === SkillAuthoringCompletionOutcomes.Succeeded)
		{
			if (!command.testReport.passed || !command.scanResult.passed) return "conflict";
			const revision = await this.transaction.skillRevision.updateMany({ where: { id: workload.skillRevisionId, state: SkillRevisionState.Draft, testReport: { equals: Prisma.DbNull }, scanResult: { equals: Prisma.DbNull } }, data: { testReport: command.testReport as unknown as Prisma.InputJsonValue, scanResult: command.scanResult as unknown as Prisma.InputJsonValue } });
			if (revision.count !== 1) return "conflict";
		}

		const completed = await this.transaction.skillWorkload.updateMany({
			where: { id: workload.id, kind: SkillWorkloadKind.Authoring, state: SkillWorkloadState.Assigned, releasedAt: workload.releasedAt, workerPodUid: identity.podUid, skillRevisionId: workload.skillRevisionId, bootstrap: { is: { consumedAt: { not: null }, consumedByPodUid: identity.podUid, namespace: identity.namespace, serviceAccountName: identity.serviceAccountName } } },
			data: command.outcome === SkillAuthoringCompletionOutcomes.Succeeded ? { state: SkillWorkloadState.Succeeded, completedAt: _SkillWorkloadTimestampProposal, failureCode: null } : { state: SkillWorkloadState.Failed, completedAt: _SkillWorkloadTimestampProposal, failureCode: command.failureCode },
		});
		if (completed.count === 1) return "completed";
		if (command.outcome === SkillAuthoringCompletionOutcomes.Succeeded) throw new _SkillWorkloadPersistenceConflictError("skill authoring completion lost its workload fence after writing revision evidence");
		return "conflict";
	}
}
