import { ArtifactRevisionState, ArtifactState, SkillRevisionState, SkillWorkloadKind, SkillWorkloadState, type Prisma } from "@prisma/client";

import type { SkillAuthoringInputRecord } from "./skill-authoring-input.types.js";
import type { SkillWorkloadBootstrapIdentity } from "./skill-workload-bootstrap.types.js";
import type { SkillAuthoringInputRepository } from "./skill-workload-unit-of-work.types.js";

/** Prisma authority selecting one draft skill's immutable source only for its exact authoring Pod. */
export class PrismaSkillAuthoringInputRepository implements SkillAuthoringInputRepository
{
	/** Transaction-scoped ORM client supplied only by the execution unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the authoring input authority over canonical Postgres. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Reads one active, published, fully-pinned artifact before the later broker revalidates its lease. */
	async load(workloadId: string, identity: SkillWorkloadBootstrapIdentity): Promise<SkillAuthoringInputRecord | null>
	{
		// 1. Rebind the workload, worker, bootstrap, and draft revision through typed relations.
		const workload = await this.transaction.skillWorkload.findFirst({
			where: { id: workloadId, kind: SkillWorkloadKind.Authoring, state: SkillWorkloadState.Assigned, releasedAt: { not: null }, workerPodUid: identity.podUid, skillRevision: { state: SkillRevisionState.Draft }, bootstrap: { is: { consumedAt: { not: null }, consumedByPodUid: identity.podUid, namespace: identity.namespace, serviceAccountName: identity.serviceAccountName, audience: "opencrane-skill-authoring" } } },
			select: { siloId: true, workloadUid: true, bootstrap: { select: { workloadUid: true } }, skillRevision: { select: { artifactId: true, artifactRevisionId: true, artifactContentAddress: true } } },
		});
		if (workload === null || workload.workloadUid === null || workload.bootstrap?.workloadUid !== workload.workloadUid) return null;

		// 2. Rebind the pinned revision to its active same-silo Artifact in the same snapshot.
		const revision = await this.transaction.artifactRevision.findFirst({
			where: { id: workload.skillRevision.artifactRevisionId, artifactId: workload.skillRevision.artifactId, contentAddress: workload.skillRevision.artifactContentAddress, state: ArtifactRevisionState.Published, artifact: { siloId: workload.siloId, state: ArtifactState.Active } },
			select: { artifactId: true, id: true, contentAddress: true, byteLength: true, mediaType: true },
		});

		// 3. End the read transaction before external ArtifactStore I/O; the broker verifies returned bytes anew.
		if (revision === null || !Number.isSafeInteger(Number(revision.byteLength)) || Number(revision.byteLength) < 0) return null;
		return { siloId: workload.siloId, artifactId: revision.artifactId, artifactRevisionId: revision.id, contentAddress: revision.contentAddress, byteLength: Number(revision.byteLength), mediaType: revision.mediaType };
	}
}
