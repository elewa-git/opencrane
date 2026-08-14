import { ArtifactRevisionState, ArtifactState, SkillRevisionState, SkillWorkloadKind, SkillWorkloadState, type Prisma } from "@prisma/client";

import type { SkillAuthoringInputRecord } from "./skill-authoring-input.types";
import type { SkillWorkloadBootstrapIdentity } from "./skill-workload-bootstrap.types";
import type { SkillAuthoringInputRepository } from "./skill-workload-unit-of-work.types";

/** Reads a draft skill's source artifact, and only for the authoring Pod that owns the workload. */
export class PrismaSkillAuthoringInputRepository implements SkillAuthoringInputRepository
{
	/** Prisma client for this transaction. Only the unit of work supplies it. */
	private readonly transaction: Prisma.TransactionClient;

	/** Stores the transaction this repository reads through. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Reads the ids of the pinned artifact. The artifact reader checks them again before it forwards any bytes. */
	async load(workloadId: string, identity: SkillWorkloadBootstrapIdentity): Promise<SkillAuthoringInputRecord | null>
	{
		// 1. Re-read the workload with its bootstrap and draft revision, requiring the reviewed Pod to match all three.
		const workload = await this.transaction.skillWorkload.findFirst({
			where: { id: workloadId, kind: SkillWorkloadKind.Authoring, state: SkillWorkloadState.Assigned, releasedAt: { not: null }, workerPodUid: identity.podUid, skillRevision: { state: SkillRevisionState.Draft }, bootstrap: { is: { consumedAt: { not: null }, consumedByPodUid: identity.podUid, namespace: identity.namespace, serviceAccountName: identity.serviceAccountName, audience: "opencrane-skill-authoring" } } },
			select: { siloId: true, workloadUid: true, bootstrap: { select: { workloadUid: true } }, skillRevision: { select: { artifactId: true, artifactRevisionId: true, artifactContentAddress: true } } },
		});
		if (workload === null || workload.workloadUid === null || workload.bootstrap?.workloadUid !== workload.workloadUid) return null;

		// 2. Look the pinned artifact revision up again, and require an active Artifact in the same silo.
		const revision = await this.transaction.artifactRevision.findFirst({
			where: { id: workload.skillRevision.artifactRevisionId, artifactId: workload.skillRevision.artifactId, contentAddress: workload.skillRevision.artifactContentAddress, state: ArtifactRevisionState.Published, artifact: { siloId: workload.siloId, state: ArtifactState.Active } },
			select: { artifactId: true, id: true, contentAddress: true, byteLength: true, mediaType: true },
		});

		// 3. Return before any ArtifactStore call, so the transaction closes first. The artifact reader checks the bytes it gets back itself.
		if (revision === null || !Number.isSafeInteger(Number(revision.byteLength)) || Number(revision.byteLength) < 0) return null;
		return { siloId: workload.siloId, artifactId: revision.artifactId, artifactRevisionId: revision.id, contentAddress: revision.contentAddress, byteLength: Number(revision.byteLength), mediaType: revision.mediaType };
	}
}
