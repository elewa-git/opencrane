import { Prisma } from "@prisma/client";

import type { SkillAuthoringInputRecord } from "./skill-authoring-input.types.js";
import type { SkillWorkloadBootstrapIdentity } from "./skill-workload-bootstrap.types.js";
import type { SkillAuthoringInputPersistence } from "./skill-workload-unit-of-work.types.js";

/** Prisma authority selecting one draft skill's immutable source only for its exact authoring Pod. */
export class PrismaSkillAuthoringInputRepository implements SkillAuthoringInputPersistence
{
	/** Transaction-scoped ORM client supplied only by the execution unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the authoring input authority over canonical Postgres. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Reads one active, published, fully-pinned artifact while sharing every relevant durable row lock. */
	async load(workloadId: string, identity: SkillWorkloadBootstrapIdentity): Promise<SkillAuthoringInputRecord | null>
	{
		// 1. Select every immutable coordinate under the reviewed worker identity before the broker sees it.
		const rows = await this.transaction.$queryRaw<readonly _InputRow[]>(Prisma.sql`
			SELECT workload."silo_id" AS "siloId", revision."artifact_id" AS "artifactId", revision."artifact_revision_id" AS "artifactRevisionId", revision."artifact_content_address" AS "contentAddress", artifact_revision."byte_length" AS "byteLength", artifact_revision."media_type" AS "mediaType"
			FROM "skill_workloads" workload
			JOIN "skill_workload_bootstraps" bootstrap ON bootstrap."skill_workload_id" = workload."id"
			JOIN "skill_revisions" revision ON revision."id" = workload."skill_revision_id"
			JOIN "artifact_revisions" artifact_revision ON artifact_revision."id" = revision."artifact_revision_id" AND artifact_revision."artifact_id" = revision."artifact_id" AND artifact_revision."content_address" = revision."artifact_content_address"
			JOIN "artifacts" artifact ON artifact."id" = artifact_revision."artifact_id" AND artifact."silo_id" = workload."silo_id"
			WHERE workload."id" = ${workloadId}
				AND workload."kind" = 'authoring'
				AND workload."state" = 'assigned'
				AND workload."released_at" IS NOT NULL
				AND workload."registered_pod_uid" = ${identity.podUid}
				AND bootstrap."consumed_at" IS NOT NULL
				AND bootstrap."consumed_by_pod_uid" = ${identity.podUid}
				AND bootstrap."namespace" = ${identity.namespace}
				AND bootstrap."service_account_name" = ${identity.serviceAccountName}
				AND bootstrap."audience" = 'opencrane-skill-authoring'
				AND bootstrap."workload_uid" = workload."workload_uid"
				AND revision."state" = 'draft'
				AND artifact."state" = 'active'
				AND artifact_revision."state" = 'published'
		`);
		// 2. End the read transaction before external ArtifactStore I/O; the broker verifies returned bytes anew.
		if (rows.length !== 1 || !Number.isSafeInteger(Number(rows[0].byteLength)) || Number(rows[0].byteLength) < 0) return null;
		return { siloId: rows[0].siloId, artifactId: rows[0].artifactId, artifactRevisionId: rows[0].artifactRevisionId, contentAddress: rows[0].contentAddress, byteLength: Number(rows[0].byteLength), mediaType: rows[0].mediaType };
	}
}

/** Raw Postgres projection retained narrow so product records never expose unrelated source metadata. */
interface _InputRow
{
	/** Durable silo coordinate. */
	readonly siloId: string;
	/** Pinned artifact coordinate. */
	readonly artifactId: string;
	/** Pinned artifact revision coordinate. */
	readonly artifactRevisionId: string;
	/** Pinned canonical content address. */
	readonly contentAddress: string;
	/** Immutable byte length from Postgres bigint. */
	readonly byteLength: bigint;
	/** Immutable media type. */
	readonly mediaType: string;
}
