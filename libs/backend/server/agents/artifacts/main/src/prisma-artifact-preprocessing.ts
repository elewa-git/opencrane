import { randomUUID } from "node:crypto";

import { ArtifactPreprocessJobState, ArtifactUploadLeaseState, Prisma, type PrismaClient } from "@prisma/client";

import type { ArtifactPreprocessClaimProjection, ArtifactPreprocessCompletionRequest, ArtifactPreprocessOutputLeaseRequest, ArtifactPreprocessRepository, ClaimNextArtifactPreprocessJobResult, CompleteArtifactPreprocessJobResult, IssueArtifactPreprocessOutputLeaseResult } from "./artifact-preprocessing.types.js";

/** Maximum capability lifetime for one bounded PDF conversion attempt. */
const _CLAIM_LIFETIME_MILLISECONDS = 60_000;

/** System principal recorded on server-finalized derived revisions. */
const _PREPROCESSOR_PRINCIPAL = "system:artifact-preprocessor";

/** Postgres authority for selecting, fencing, and completing dedicated PDF preprocessing work. */
export class PrismaArtifactPreprocessRepository implements ArtifactPreprocessRepository
{
	/** Canonical OpenCrane catalog database client. */
	private readonly prisma: PrismaClient;

	/** Creates the preprocessing authority over the only catalog database. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Claims one pending or eligible retried job while holding its source and output authority locks. */
	async claimNextAtomically(): Promise<ClaimNextArtifactPreprocessJobResult>
	{
		return this.prisma.$transaction(async function _claim(transaction)
		{
			// 1. Recover expired claims first so their associated output capability is cancelled by the SQL authority.
			await transaction.$executeRaw(Prisma.sql`UPDATE "artifact_preprocess_jobs" SET "state" = 'retryable_failed', "output_lease_id" = NULL, "failure_code" = 'claim_expired', "next_attempt_at" = clock_timestamp(), "updated_at" = clock_timestamp() WHERE "state" = 'claimed' AND "claim_expires_at" <= clock_timestamp()`);

			// 2. Lock one candidate and its immutable source metadata; SKIP LOCKED keeps pollers independent.
			const candidates = await transaction.$queryRaw<Array<{ jobId: string; attempt: number; derivedArtifactId: string | null; sourceRevisionId: string; siloId: string; ownerPrincipalId: string; sourceContentAddress: string; sourceByteLength: bigint }>>(Prisma.sql`SELECT job."id" AS "jobId", job."attempt", job."derived_artifact_id" AS "derivedArtifactId", revision."id" AS "sourceRevisionId", artifact."silo_id" AS "siloId", artifact."owner_principal_id" AS "ownerPrincipalId", revision."content_address" AS "sourceContentAddress", revision."byte_length" AS "sourceByteLength" FROM "artifact_preprocess_jobs" job JOIN "artifact_revisions" revision ON revision."id" = job."source_revision_id" JOIN "artifacts" artifact ON artifact."id" = revision."artifact_id" WHERE job."state" IN ('pending', 'retryable_failed') AND (job."next_attempt_at" IS NULL OR job."next_attempt_at" <= clock_timestamp()) ORDER BY job."created_at" FOR UPDATE OF job, revision, artifact SKIP LOCKED LIMIT 1`);
			const candidate = candidates[0];
			if (candidate === undefined) return { status: "none" };

			// 3. Allocate the one generated Artifact before the claim transition; retries retain this ownership boundary.
			const derivedArtifactId = candidate.derivedArtifactId ?? randomUUID();
			if (candidate.derivedArtifactId === null)
			{
				await transaction.artifact.create({ data: { id: derivedArtifactId, siloId: candidate.siloId, ownerPrincipalId: candidate.ownerPrincipalId, kind: "Generated" } });
			}
			const claimFence = randomUUID();
			const claimExpiresAt = new Date(Date.now() + _CLAIM_LIFETIME_MILLISECONDS);
			await transaction.artifactPreprocessJob.update({ where: { id: candidate.jobId }, data: { state: ArtifactPreprocessJobState.Claimed, attempt: candidate.attempt + 1, claimFence, claimExpiresAt, nextAttemptAt: null, failureCode: null, derivedArtifactId } });

			return { status: "claimed", claim: { jobId: candidate.jobId, attempt: candidate.attempt + 1, claimFence, claimExpiresAt, sourceRevisionId: candidate.sourceRevisionId, siloId: candidate.siloId, sourceContentAddress: candidate.sourceContentAddress, sourceByteLength: Number(candidate.sourceByteLength), derivedArtifactId } };
		});
	}

	/** Creates one exact active lease only for the current unexpired fence. */
	async issueOutputLeaseAtomically(request: ArtifactPreprocessOutputLeaseRequest): Promise<IssueArtifactPreprocessOutputLeaseResult>
	{
		return this.prisma.$transaction(async function _issue(transaction)
		{
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "artifact_preprocess_jobs" WHERE "id" = ${request.jobId} FOR UPDATE`);
			const job = await transaction.artifactPreprocessJob.findUnique({ where: { id: request.jobId }, include: { derivedArtifact: true } });
			if (job === null || job.derivedArtifact === null) return { status: "conflict", reason: "claim_not_found" };
			if (job.state !== ArtifactPreprocessJobState.Claimed || job.attempt !== request.attempt || job.claimFence !== request.claimFence || job.claimExpiresAt === null || job.claimExpiresAt <= new Date()) return { status: "conflict", reason: "stale_claim" };
			if (job.outputLeaseId !== null || !request.contentAddress.startsWith("sha256:") || request.byteLength < 0) return { status: "conflict", reason: "invalid_output" };

			const leaseId = randomUUID();
			const capabilityJti = randomUUID();
			await transaction.artifactUploadLease.create({ data: { id: leaseId, artifactId: job.derivedArtifactId!, siloId: job.derivedArtifact.siloId, capabilityJti, expectedContentAddress: request.contentAddress, expectedByteLength: BigInt(request.byteLength), mediaType: "text/plain", expiresAt: job.claimExpiresAt } });
			await transaction.artifactPreprocessJob.update({ where: { id: job.id }, data: { outputLeaseId: leaseId } });
			return { status: "issued", lease: { jobId: job.id, attempt: job.attempt, claimFence: job.claimFence, derivedRevisionId: _DerivedRevisionId(leaseId), writeLease: { leaseId, siloId: job.derivedArtifact.siloId, artifactId: job.derivedArtifactId!, action: "artifact.write", expiresAtEpochSeconds: Math.floor(job.claimExpiresAt.getTime() / 1_000), expectedContentAddress: request.contentAddress, expectedByteLength: request.byteLength, mediaType: "text/plain" } } };
		});
	}

	/** Consumes a receipt and marks the job complete in the same catalog transaction. */
	async completeAtomically(request: ArtifactPreprocessCompletionRequest): Promise<CompleteArtifactPreprocessJobResult>
	{
		return this.prisma.$transaction(async function _complete(transaction)
		{
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "artifact_preprocess_jobs" WHERE "id" = ${request.jobId} FOR UPDATE`);
			const job = await transaction.artifactPreprocessJob.findUnique({ where: { id: request.jobId }, include: { outputLease: true, derivedArtifact: true } });
			if (job === null || job.outputLease === null || job.derivedArtifact === null) return { status: "conflict", reason: "claim_not_found" };
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "artifact_upload_leases" WHERE "id" = ${job.outputLease.id} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "artifacts" WHERE "id" = ${job.derivedArtifact.id} FOR UPDATE`);
			if (job.state !== ArtifactPreprocessJobState.Claimed || job.attempt !== request.attempt || job.claimFence !== request.claimFence || job.claimExpiresAt === null || job.claimExpiresAt <= new Date() || request.derivedRevisionId !== _DerivedRevisionId(job.outputLease.id)) return { status: "conflict", reason: "stale_claim" };
			if (request.promotion.leaseId !== job.outputLease.id || request.promotion.contentAddress !== job.outputLease.expectedContentAddress || request.promotion.byteLength !== Number(job.outputLease.expectedByteLength) || request.promotion.mediaType !== "text/plain") return { status: "conflict", reason: "invalid_receipt" };

			await transaction.artifactUploadLease.update({ where: { id: job.outputLease.id }, data: { state: ArtifactUploadLeaseState.Promoted, promotionReceiptDigest: request.receiptDigest, promotedContentAddress: request.promotion.contentAddress, promotedByteLength: BigInt(request.promotion.byteLength), promotedAt: new Date() } });
			await transaction.artifactRevision.create({ data: { id: request.derivedRevisionId, artifactId: job.derivedArtifactId!, revision: 1, contentAddress: request.promotion.contentAddress, byteLength: BigInt(request.promotion.byteLength), mediaType: "text/plain", provenance: { pipelineVersion: "pdf-to-text/v1", sourceRevisionId: job.sourceRevisionId }, createdBy: _PREPROCESSOR_PRINCIPAL } });
			await transaction.artifact.update({ where: { id: job.derivedArtifactId! }, data: { currentRevisionId: request.derivedRevisionId } });
			await transaction.artifactRevisionParent.create({ data: { childRevisionId: request.derivedRevisionId, parentRevisionId: job.sourceRevisionId } });
			await transaction.artifactOutboxEvent.create({ data: { artifactId: job.derivedArtifactId!, revisionId: request.derivedRevisionId, kind: "RevisionPublished", idempotencyKey: `artifact-preprocess:${job.id}:${job.attempt}:revision`, payload: { contentAddress: request.promotion.contentAddress, byteLength: request.promotion.byteLength, mediaType: "text/plain" } } });
			await transaction.artifactOutboxEvent.create({ data: { artifactId: job.derivedArtifactId!, revisionId: request.derivedRevisionId, kind: "PreprocessingCompleted", idempotencyKey: `artifact-preprocess:${job.id}:${job.attempt}:completed`, payload: { pipelineVersion: "pdf-to-text/v1", sourceRevisionId: job.sourceRevisionId } } });
			await transaction.artifactUploadLease.update({ where: { id: job.outputLease.id }, data: { state: ArtifactUploadLeaseState.Finalized, finalizedAt: new Date() } });
			await transaction.artifactPreprocessJob.update({ where: { id: job.id }, data: { state: ArtifactPreprocessJobState.Completed, derivedRevisionId: request.derivedRevisionId, completedAt: new Date() } });
			return { status: "completed" };
		});
	}
}

/** Derive the only allowed output revision coordinate from its durable exact-byte lease. */
function _DerivedRevisionId(leaseId: string): string
{
	return `artifact-preprocess:${leaseId}`;
}
