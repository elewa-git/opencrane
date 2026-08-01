import { randomUUID } from "node:crypto";

import { ArtifactKind, ArtifactPreprocessJobState, ArtifactRevisionState, ArtifactState, ArtifactUploadLeaseState, Prisma } from "@prisma/client";

import type { ArtifactPreprocessorClaimCommand, ArtifactPreprocessorFailureCommand } from "@opencrane/contracts";
import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";

import type { ArtifactPreprocessClaimProjection, ArtifactPreprocessCompletionRequest, ArtifactPreprocessOutputLeaseProjection, ArtifactPreprocessOutputLeaseRequest, ArtifactPreprocessRepository, ArtifactPreprocessSourceLeaseProjection, ClaimNextArtifactPreprocessJobResult, CompleteArtifactPreprocessJobResult, FailArtifactPreprocessJobResult, IssueArtifactPreprocessOutputLeaseResult } from "./artifact-preprocessing.types.js";

/** Maximum time one worker attempt may retain source and output authority. */
const _CLAIM_LIFETIME_MILLISECONDS = 5 * 60_000;

/** Maximum attempts before a deterministic conversion failure becomes terminal. */
const _MAX_ATTEMPTS = 3;

/** Base delay applied before an eligible failed job may be reclaimed. */
const _RETRY_DELAY_MILLISECONDS = 30_000;

/** Maximum source-read authority, matched to the minimum quiet period before an early retry. */
const _SOURCE_READ_LEASE_MILLISECONDS = _RETRY_DELAY_MILLISECONDS;

/** Fixed source pipeline admitted by the dedicated worker. */
const _PDF_TO_TEXT_PIPELINE_VERSION = "pdf-to-text/v1";

/** System principal recorded on server-finalized derived revisions. */
const _PREPROCESSOR_PRINCIPAL = "system:artifact-preprocessor";

/** Transaction-scoped repository for selecting, fencing, and completing dedicated PDF preprocessing work. */
export class PrismaArtifactPreprocessRepository implements ArtifactPreprocessRepository
{
	/** Private transaction client supplied only by the preprocessing unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the repository for one already-open preprocessing transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Claims one pending or eligible retried job while holding its source and output locks. */
	async claimNextAtomically(): Promise<ClaimNextArtifactPreprocessJobResult>
	{
		{
			const transaction = this.transaction;
			// 1. Recover expired claims first; the lifecycle trigger cancels any stale output lease.
			await transaction.$executeRaw(Prisma.sql`UPDATE "artifact_preprocess_jobs" SET "state" = 'retryable_failed', "output_lease_id" = NULL, "failure_code" = 'claim_expired', "next_attempt_at" = clock_timestamp(), "updated_at" = clock_timestamp() WHERE "state" = 'claimed' AND "claim_expires_at" <= clock_timestamp()`);

			// 2. Lock one eligible job and its immutable source; SKIP LOCKED keeps peer pollers independent.
			const candidates = await transaction.$queryRaw<Array<{ jobId: string; attempt: number; derivedArtifactId: string | null; sourceRevisionId: string; sourceArtifactId: string; siloId: string; ownerPrincipalId: string; sourceByteLength: bigint }>>(Prisma.sql`SELECT job."id" AS "jobId", job."attempt", job."derived_artifact_id" AS "derivedArtifactId", revision."id" AS "sourceRevisionId", revision."artifact_id" AS "sourceArtifactId", artifact."silo_id" AS "siloId", artifact."owner_principal_id" AS "ownerPrincipalId", revision."byte_length" AS "sourceByteLength" FROM "artifact_preprocess_jobs" job JOIN "artifact_revisions" revision ON revision."id" = job."source_revision_id" JOIN "artifacts" artifact ON artifact."id" = revision."artifact_id" WHERE job."state" IN ('pending', 'retryable_failed') AND (job."next_attempt_at" IS NULL OR job."next_attempt_at" <= clock_timestamp()) ORDER BY job."created_at" FOR UPDATE OF job, revision, artifact SKIP LOCKED LIMIT 1`);
			const candidate = candidates[0];
			if (candidate === undefined) return { status: "none" };
			if (!_IsSafeByteLength(candidate.sourceByteLength)) throw new Error("artifact preprocess source byte length exceeds the supported range");

			// 3. Allocate the hidden generated Artifact once; catalogue listings require a current revision.
			const derivedArtifactId = candidate.derivedArtifactId ?? randomUUID();
			if (candidate.derivedArtifactId === null)
			{
				await transaction.artifact.create({ data: { id: derivedArtifactId, siloId: candidate.siloId, ownerPrincipalId: candidate.ownerPrincipalId, kind: ArtifactKind.Generated } });
			}

			// 4. Advance from database time so every poller observes the same claim-expiry authority.
			const now = await _DatabaseNow(transaction);
			const claimFence = randomUUID();
			const claimExpiresAt = new Date(now.getTime() + _CLAIM_LIFETIME_MILLISECONDS);
			await transaction.artifactPreprocessJob.update({ where: { id: candidate.jobId }, data: { state: ArtifactPreprocessJobState.Claimed, attempt: candidate.attempt + 1, claimFence, claimExpiresAt, nextAttemptAt: null, failureCode: null, outputLeaseId: null, derivedArtifactId } });

			return { status: "claimed", claim: { jobId: candidate.jobId, attempt: candidate.attempt + 1, claimFence, claimExpiresAt, sourceRevisionId: candidate.sourceRevisionId, sourceArtifactId: candidate.sourceArtifactId, siloId: candidate.siloId, sourceByteLength: Number(candidate.sourceByteLength) } satisfies ArtifactPreprocessClaimProjection };
		}
	}

	/** Allocates one source-read lease only while the exact claim fence remains current. */
	async issueSourceLeaseAtomically(command: ArtifactPreprocessorClaimCommand): Promise<ArtifactPreprocessSourceLeaseProjection | null>
	{
		{
			const transaction = this.transaction;
			// 1. Lock the job before reading its fence so failure and reclaim cannot interleave with lease issuance.
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "artifact_preprocess_jobs" WHERE "id" = ${command.jobId} FOR UPDATE`);

			// 2. Load database time and the exact job relation in one transaction so the fence decision uses one authority.
			const now = await _DatabaseNow(transaction);
			const job = await transaction.artifactPreprocessJob.findUnique({ where: { id: command.jobId }, include: { sourceRevision: { include: { artifact: true } } } });
			if (job === null
				|| job.state !== ArtifactPreprocessJobState.Claimed
				|| job.attempt !== command.attempt
				|| job.claimFence !== command.claimFence
				|| job.claimExpiresAt === null
				|| job.claimExpiresAt <= now
				|| job.pipelineVersion !== _PDF_TO_TEXT_PIPELINE_VERSION
				|| job.sourceRevision.state !== ArtifactRevisionState.Published
				|| job.sourceRevision.mediaType !== "application/pdf"
				|| job.sourceRevision.artifact.state !== ArtifactState.Active
				|| !___IsSha256ContentAddress(job.sourceRevision.contentAddress)
				|| !_IsSafeByteLength(job.sourceRevision.byteLength))
			{
				return null;
			}

			// 3. Cap authority to both the claim and retry quiet period, so failure cannot create overlapping attempts.
			const expiresAtEpochSeconds = Math.floor(Math.min(job.claimExpiresAt.getTime(), now.getTime() + _SOURCE_READ_LEASE_MILLISECONDS) / 1_000);
			if (expiresAtEpochSeconds <= Math.floor(now.getTime() / 1_000)) return null;
			return {
				readLease: {
					leaseId: randomUUID(),
					siloId: job.sourceRevision.artifact.siloId,
					artifactId: job.sourceRevision.artifactId,
					artifactRevisionId: job.sourceRevision.id,
					contentAddress: job.sourceRevision.contentAddress,
					byteLength: Number(job.sourceRevision.byteLength),
					mediaType: "application/pdf",
					action: "artifact.read",
					expiresAtEpochSeconds,
				},
				byteLength: Number(job.sourceRevision.byteLength),
				mediaType: "application/pdf",
			};
		}
	}

	/** Creates or reloads one exact active output lease for the current unexpired fence. */
	async issueOutputLeaseAtomically(request: ArtifactPreprocessOutputLeaseRequest): Promise<IssueArtifactPreprocessOutputLeaseResult>
	{
		{
			const transaction = this.transaction;
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "artifact_preprocess_jobs" WHERE "id" = ${request.jobId} FOR UPDATE`);
			const now = await _DatabaseNow(transaction);
			const job = await transaction.artifactPreprocessJob.findUnique({ where: { id: request.jobId }, include: { derivedArtifact: true, outputLease: true } });
			if (job === null || job.derivedArtifact === null) return { status: "conflict", reason: "claim_not_found" };
			if (job.attempt !== request.attempt || job.claimFence !== request.claimFence) return { status: "conflict", reason: "stale_claim" };
			if (job.state === ArtifactPreprocessJobState.Completed)
			{
				return job.outputLease !== null
					&& job.outputLease.expectedContentAddress === request.contentAddress
					&& job.outputLease.expectedByteLength === BigInt(request.byteLength)
					&& job.outputLease.mediaType === "text/plain"
					? { status: "completed" }
					: { status: "conflict", reason: "invalid_output" };
			}
			if (job.state !== ArtifactPreprocessJobState.Claimed || job.claimExpiresAt === null || job.claimExpiresAt <= now) return { status: "conflict", reason: "stale_claim" };
			if (!___IsSha256ContentAddress(request.contentAddress) || !Number.isSafeInteger(request.byteLength) || request.byteLength < 0) return { status: "conflict", reason: "invalid_output" };

			// A repeated body after response loss reuses the same exact lease instead of creating parallel output authority.
			if (job.outputLease !== null)
			{
				if (job.outputLease.state !== ArtifactUploadLeaseState.Active
					|| job.outputLease.expiresAt <= now
					|| job.outputLease.expectedContentAddress !== request.contentAddress
					|| job.outputLease.expectedByteLength !== BigInt(request.byteLength)
					|| job.outputLease.mediaType !== "text/plain")
				{
					return { status: "conflict", reason: "invalid_output" };
				}
				return { status: "issued", lease: _OutputLeaseProjection(job.id, job.attempt, job.claimFence, job.derivedArtifact.id, job.outputLease.id, job.outputLease.siloId, job.outputLease.expiresAt, request.contentAddress, request.byteLength) };
			}

			const leaseId = randomUUID();
			await transaction.artifactUploadLease.create({ data: { id: leaseId, artifactId: job.derivedArtifact.id, siloId: job.derivedArtifact.siloId, capabilityJti: randomUUID(), expectedContentAddress: request.contentAddress, expectedByteLength: BigInt(request.byteLength), mediaType: "text/plain", expiresAt: job.claimExpiresAt } });
			await transaction.artifactPreprocessJob.update({ where: { id: job.id }, data: { outputLeaseId: leaseId } });
			return { status: "issued", lease: _OutputLeaseProjection(job.id, job.attempt, job.claimFence, job.derivedArtifact.id, leaseId, job.derivedArtifact.siloId, job.claimExpiresAt, request.contentAddress, request.byteLength) };
		}
	}

	/** Consumes a receipt and publishes the generated text revision in the same transaction. */
	async completeAtomically(request: ArtifactPreprocessCompletionRequest): Promise<CompleteArtifactPreprocessJobResult>
	{
		{
			const transaction = this.transaction;
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "artifact_preprocess_jobs" WHERE "id" = ${request.jobId} FOR UPDATE`);
			const now = await _DatabaseNow(transaction);
			const job = await transaction.artifactPreprocessJob.findUnique({ where: { id: request.jobId }, include: { outputLease: true, derivedArtifact: true } });
			if (job === null || job.outputLease === null || job.derivedArtifact === null) return { status: "conflict", reason: "claim_not_found" };
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "artifact_upload_leases" WHERE "id" = ${job.outputLease.id} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "artifacts" WHERE "id" = ${job.derivedArtifact.id} FOR UPDATE`);
			if (job.attempt !== request.attempt || job.claimFence !== request.claimFence || request.derivedRevisionId !== _DerivedRevisionId(job.outputLease.id)) return { status: "conflict", reason: "stale_claim" };
			if (!_MatchesPromotion(request, job.outputLease)) return { status: "conflict", reason: "invalid_receipt" };
			if (job.state === ArtifactPreprocessJobState.Completed) return { status: "completed" };
			if (job.state !== ArtifactPreprocessJobState.Claimed || job.claimExpiresAt === null || job.claimExpiresAt <= now) return { status: "conflict", reason: "stale_claim" };

			// 1. Persist the service receipt before publishing any catalogue-visible revision.
			await transaction.artifactUploadLease.update({ where: { id: job.outputLease.id }, data: { state: ArtifactUploadLeaseState.Promoted, promotionReceiptDigest: request.receiptDigest, promotedContentAddress: request.promotion.contentAddress, promotedByteLength: BigInt(request.promotion.byteLength), promotedAt: now } });

			// 2. Publish the derived revision, current pointer, and immutable source lineage together.
			await transaction.artifactRevision.create({ data: { id: request.derivedRevisionId, artifactId: job.derivedArtifact.id, revision: 1, contentAddress: request.promotion.contentAddress, byteLength: BigInt(request.promotion.byteLength), mediaType: "text/plain", provenance: { pipelineVersion: _PDF_TO_TEXT_PIPELINE_VERSION, sourceRevisionId: job.sourceRevisionId }, createdBy: _PREPROCESSOR_PRINCIPAL } });
			await transaction.artifact.update({ where: { id: job.derivedArtifact.id }, data: { currentRevisionId: request.derivedRevisionId } });
			await transaction.artifactRevisionParent.create({ data: { childRevisionId: request.derivedRevisionId, parentRevisionId: job.sourceRevisionId } });

			// 3. Emit the normal publication event and close both lease and job under deferred SQL guards.
			await transaction.artifactOutboxEvent.create({ data: { artifactId: job.derivedArtifact.id, revisionId: request.derivedRevisionId, kind: "RevisionPublished", idempotencyKey: `artifact-preprocess:${job.id}:${job.attempt}:revision`, payload: { contentAddress: request.promotion.contentAddress, byteLength: request.promotion.byteLength, mediaType: "text/plain" } } });
			await transaction.artifactUploadLease.update({ where: { id: job.outputLease.id }, data: { state: ArtifactUploadLeaseState.Finalized, finalizedAt: now } });
			await transaction.artifactPreprocessJob.update({ where: { id: job.id }, data: { state: ArtifactPreprocessJobState.Completed, derivedRevisionId: request.derivedRevisionId, completedAt: now } });
			return { status: "completed" };
		}
	}

	/** Records a current worker failure and applies bounded retry or terminal policy. */
	async failAtomically(command: ArtifactPreprocessorFailureCommand): Promise<FailArtifactPreprocessJobResult>
	{
		{
			const transaction = this.transaction;
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "artifact_preprocess_jobs" WHERE "id" = ${command.jobId} FOR UPDATE`);
			const now = await _DatabaseNow(transaction);
			const job = await transaction.artifactPreprocessJob.findUnique({ where: { id: command.jobId } });
			if (job === null) return { status: "conflict", reason: "claim_not_found" };
			if (job.state !== ArtifactPreprocessJobState.Claimed || job.attempt !== command.attempt || job.claimFence !== command.claimFence || job.claimExpiresAt === null || job.claimExpiresAt <= now) return { status: "conflict", reason: "stale_claim" };

			const terminal = job.attempt >= _MAX_ATTEMPTS;
			await transaction.artifactPreprocessJob.update({
				where: { id: job.id },
				data: { state: terminal ? ArtifactPreprocessJobState.TerminalFailed : ArtifactPreprocessJobState.RetryableFailed, outputLeaseId: null, failureCode: command.failureCode, nextAttemptAt: terminal ? null : new Date(now.getTime() + _RETRY_DELAY_MILLISECONDS * job.attempt) },
			});
			return { status: terminal ? "terminal" : "retryable" };
		}
	}
}

/** Read database time inside the active transaction so expiry decisions share one clock. */
async function _DatabaseNow(transaction: Prisma.TransactionClient): Promise<Date>
{
	const rows = await transaction.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp() AS "now"`);
	const now = rows[0]?.now;
	if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error("database clock unavailable");
	return now;
}

/** Prove a Postgres bigint can cross the JavaScript and HTTP boundaries without truncation. */
function _IsSafeByteLength(value: bigint): boolean
{
	return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER);
}

/** Build the only output lease shape admitted by the app-owned signer. */
function _OutputLeaseProjection(jobId: string, attempt: number, claimFence: string, artifactId: string, leaseId: string, siloId: string, expiresAt: Date, contentAddress: string, byteLength: number): ArtifactPreprocessOutputLeaseProjection
{
	return { jobId, attempt, claimFence, derivedRevisionId: _DerivedRevisionId(leaseId), writeLease: { leaseId, siloId, artifactId, action: "artifact.write" as const, expiresAtEpochSeconds: Math.floor(expiresAt.getTime() / 1_000), expectedContentAddress: contentAddress, expectedByteLength: byteLength, mediaType: "text/plain" } };
}

/** Match the verified receipt to the exact durable lease before any catalogue publication. */
function _MatchesPromotion(request: ArtifactPreprocessCompletionRequest, lease: { readonly id: string; readonly expectedContentAddress: string | null; readonly expectedByteLength: bigint | null; readonly mediaType: string }): boolean
{
	return request.promotion.leaseId === lease.id
		&& request.promotion.contentAddress === lease.expectedContentAddress
		&& lease.expectedByteLength !== null
		&& _IsSafeByteLength(lease.expectedByteLength)
		&& request.promotion.byteLength === Number(lease.expectedByteLength)
		&& request.promotion.mediaType === lease.mediaType
		&& lease.mediaType === "text/plain";
}

/** Derive the only allowed output revision coordinate from its durable exact-byte lease. */
function _DerivedRevisionId(leaseId: string): string
{
	return `artifact-preprocess:${leaseId}`;
}
