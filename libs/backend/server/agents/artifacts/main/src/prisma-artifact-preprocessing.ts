import { randomUUID } from "node:crypto";

import { ArtifactPreprocessJobState, ArtifactRevisionState, ArtifactState, ArtifactUploadLeaseState, type Prisma } from "@prisma/client";

import type { ArtifactPreprocessCompletion, ArtifactPreprocessControllerRecord, ArtifactPreprocessPodBindCommand, ArtifactPreprocessWorkloadBindCommand } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import type { ArtifactPreprocessorClaimCommand, ArtifactPreprocessorFailureCommand } from "@opencrane/contracts";
import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";

import type { ArtifactPreprocessCompletionRequest, ArtifactPreprocessOutputLeaseProjection, ArtifactPreprocessOutputLeaseRequest, ArtifactPreprocessRepository, ArtifactPreprocessSourceLeaseProjection, CompleteArtifactPreprocessJobResult, FailArtifactPreprocessJobResult, IssueArtifactPreprocessOutputLeaseResult } from "./artifact-preprocessing.types";
import { PrismaArtifactPreprocessControllerRepository } from "./prisma-artifact-preprocess-controller-authority";

/** Total attempts a job gets. A failure reported on attempt 3 is marked TerminalFailed and the job never runs again. */
const _MAX_ATTEMPTS = 3;

/** Base delay applied before an eligible failed job may be reclaimed. */
const _RETRY_DELAY_MILLISECONDS = 30_000;

/** How long a source-read permission lasts. Deliberately equal to the shortest wait before a failed job can be reclaimed, so a lease from one attempt has expired by the time the next attempt starts.  */
const _SOURCE_READ_LEASE_MILLISECONDS = _RETRY_DELAY_MILLISECONDS;

/** Fixed source pipeline admitted by the dedicated worker. */
const _PDF_TO_TEXT_PIPELINE_VERSION = "pdf-to-text/v1";

/** System principal recorded on server-finalized derived revisions. */
const _PREPROCESSOR_PRINCIPAL = "system:artifact-preprocessor";

/**
 * Runs the preprocessing SQL inside a transaction someone else already opened.
 *
 * Built per call by `PrismaArtifactPreprocessUnitOfWork` and handed the transaction client. Two
 * rules hold across every method here: the current time always comes from the database, never
 * from this process, so all pods agree on when a claim expires; and every method after the claim
 * re-checks the job's state, attempt, fence, and expiry before writing, so a worker whose claim
 * lapsed cannot change a job another attempt has taken over.
 *
 * Called by: `PrismaArtifactPreprocessUnitOfWork.run` in
 * prisma-artifact-preprocess-unit-of-work.ts.
 */
export class PrismaArtifactPreprocessRepository implements ArtifactPreprocessRepository
{
	/** Private transaction client supplied only by the preprocessing unit of work. */
	private readonly transaction: Prisma.TransactionClient;
	/** Task-fenced controller lifecycle bound to the same private transaction. */
	private readonly controller: PrismaArtifactPreprocessControllerRepository;

	/** Creates the repository for one already-open preprocessing transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
		this.controller = new PrismaArtifactPreprocessControllerRepository(this.transaction);
	}

	/** Issues or reloads the controller claim for one exact admitted task. */
	claimForTask(preprocessJobId: string, task: IWorkflowTaskReceipt): Promise<ArtifactPreprocessControllerRecord | null>
	{
		return this.controller.claimForTask(preprocessJobId, task);
	}

	/** Saves the Job UID and hashed bootstrap under the exact controller delivery. */
	bindWorkload(preprocessJobId: string, task: IWorkflowTaskReceipt, command: ArtifactPreprocessWorkloadBindCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		return this.controller.bindWorkload(preprocessJobId, task, command);
	}

	/** Saves the first Pod UID beneath the Job accepted for the current delivery. */
	bindFirstPod(preprocessJobId: string, task: IWorkflowTaskReceipt, command: ArtifactPreprocessPodBindCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		return this.controller.bindFirstPod(preprocessJobId, task, command);
	}

	/** Loads the completion inbox through the exact workflow receipt boundary. */
	loadCompletion(preprocessJobId: string, completionDigest: string, task: IWorkflowTaskReceipt): Promise<ArtifactPreprocessCompletion | null>
	{
		return this.controller.loadCompletion(preprocessJobId, completionDigest, task);
	}

	/** Makes a recorded completion terminal once and reports exact replays idempotently. */
	complete(preprocessJobId: string, completion: ArtifactPreprocessCompletion, task: IWorkflowTaskReceipt): Promise<"completed" | "idempotent" | "conflict">
	{
		return this.controller.complete(preprocessJobId, completion, task);
	}

	/** Allocates one source-read lease only while the exact claim fence remains current. */
	async issueSourceLeaseAtomically(command: ArtifactPreprocessorClaimCommand): Promise<ArtifactPreprocessSourceLeaseProjection | null>
	{
		{
			const transaction = this.transaction;
			// 1. Load database time and the exact job relation from one serializable snapshot.
			const now = await this._databaseNow();
			const job = await transaction.artifactPreprocessJob.findUnique({ where: { id: command.jobId }, include: { sourceRevision: { include: { artifact: true } } } });
			if (job === null
				|| job.state !== ArtifactPreprocessJobState.Claimed
				|| job.deliveryCount !== command.attempt
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

			// 2. End the read permission at whichever comes first, the claim expiry or the retry wait, so a lease from this attempt is dead before the next attempt can start.
			const expiresAtEpochSeconds = Math.floor(Math.min(job.claimExpiresAt.getTime(), now.getTime() + _SOURCE_READ_LEASE_MILLISECONDS) / 1_000);
			if (expiresAtEpochSeconds <= Math.floor(now.getTime() / 1_000))
			{
				return null;
			}
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
			const now = await this._databaseNow();
			const job = await transaction.artifactPreprocessJob.findUnique({ where: { id: request.jobId }, include: { derivedArtifact: true, outputLease: true } });
			if (job === null || job.derivedArtifact === null)
			{
				return { status: "conflict", reason: "claim_not_found" };
			}
			if (job.deliveryCount !== request.attempt || job.claimFence !== request.claimFence)
			{
				return { status: "conflict", reason: "stale_claim" };
			}
			if (job.completionDigest !== null || job.state === ArtifactPreprocessJobState.Completed)
			{
				return job.outputLease !== null
					&& job.outputLease.expectedContentAddress === request.contentAddress
					&& job.outputLease.expectedByteLength === BigInt(request.byteLength)
					&& job.outputLease.mediaType === "text/plain"
					? { status: "completed" }
					: { status: "conflict", reason: "invalid_output" };
			}
			if (job.state !== ArtifactPreprocessJobState.Claimed || job.claimExpiresAt === null || job.claimExpiresAt <= now)
			{
				return { status: "conflict", reason: "stale_claim" };
			}
			if (!___IsSha256ContentAddress(request.contentAddress) || !Number.isSafeInteger(request.byteLength) || request.byteLength < 0)
			{
				return { status: "conflict", reason: "invalid_output" };
			}

			// If the worker resends the same bytes because it never saw our reply, hand back the lease already attached to this attempt rather than creating a second one.
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
				return { status: "issued", lease: _OutputLeaseProjection(job.id, job.deliveryCount, job.claimFence, job.derivedArtifact.id, job.outputLease.id, job.outputLease.siloId, job.outputLease.expiresAt, request.contentAddress, request.byteLength) };
			}

			const leaseId = randomUUID();
			await transaction.artifactUploadLease.create({ data: { id: leaseId, artifactId: job.derivedArtifact.id, siloId: job.derivedArtifact.siloId, capabilityJti: randomUUID(), expectedContentAddress: request.contentAddress, expectedByteLength: BigInt(request.byteLength), mediaType: "text/plain", expiresAt: job.claimExpiresAt } });
			await transaction.artifactPreprocessJob.update({ where: { id: job.id }, data: { outputLeaseId: leaseId } });
			return { status: "issued", lease: _OutputLeaseProjection(job.id, job.deliveryCount, job.claimFence, job.derivedArtifact.id, leaseId, job.derivedArtifact.siloId, job.claimExpiresAt, request.contentAddress, request.byteLength) };
		}
	}

	/** Consumes a receipt, publishes the generated text revision, and records controller completion. */
	async completeAtomically(request: ArtifactPreprocessCompletionRequest): Promise<CompleteArtifactPreprocessJobResult>
	{
		{
			const transaction = this.transaction;
			const now = await this._databaseNow();
			const job = await transaction.artifactPreprocessJob.findUnique({ where: { id: request.jobId }, include: { outputLease: true, derivedArtifact: true } });
			if (job === null || job.outputLease === null || job.derivedArtifact === null)
			{
				return { status: "conflict", reason: "claim_not_found" };
			}
			if (job.deliveryCount !== request.attempt || job.claimFence !== request.claimFence || request.derivedRevisionId !== _DerivedRevisionId(job.outputLease.id))
			{
				return { status: "conflict", reason: "stale_claim" };
			}
			if (!_MatchesPromotion(request, job.outputLease))
			{
				return { status: "conflict", reason: "invalid_receipt" };
			}
			if (job.completionDigest === request.receiptDigest)
			{
				return { status: "completed" };
			}
			if (job.state !== ArtifactPreprocessJobState.Claimed || job.claimExpiresAt === null || job.claimExpiresAt <= now)
			{
				return { status: "conflict", reason: "stale_claim" };
			}

			// 1. Mark the lease Promoted and store the receipt digest first, so the receipt is on record before anything becomes visible.
			await transaction.artifactUploadLease.update({ where: { id: job.outputLease.id }, data: { state: ArtifactUploadLeaseState.Promoted, promotionReceiptDigest: request.receiptDigest, promotedContentAddress: request.promotion.contentAddress, promotedByteLength: BigInt(request.promotion.byteLength), promotedAt: now } });

			// 2. Publish the derived revision, current pointer, and immutable source lineage together.
			await transaction.artifactRevision.create({ data: { id: request.derivedRevisionId, artifactId: job.derivedArtifact.id, revision: 1, contentAddress: request.promotion.contentAddress, byteLength: BigInt(request.promotion.byteLength), mediaType: "text/plain", provenance: { pipelineVersion: _PDF_TO_TEXT_PIPELINE_VERSION, sourceRevisionId: job.sourceRevisionId }, createdBy: _PREPROCESSOR_PRINCIPAL } });
			await transaction.artifact.update({ where: { id: job.derivedArtifact.id }, data: { currentRevisionId: request.derivedRevisionId } });
			await transaction.artifactRevisionParent.create({ data: { childRevisionId: request.derivedRevisionId, parentRevisionId: job.sourceRevisionId } });

			// 3. Write the same publication event an ordinary upload writes, finalize the lease, and save the controller completion inbox entry in this one commit.
			await transaction.artifactOutboxEvent.create({ data: { artifactId: job.derivedArtifact.id, revisionId: request.derivedRevisionId, kind: "RevisionPublished", idempotencyKey: `artifact-preprocess:${job.id}:${job.deliveryCount}:revision`, payload: { contentAddress: request.promotion.contentAddress, byteLength: request.promotion.byteLength, mediaType: "text/plain" } } });
			await transaction.artifactUploadLease.update({ where: { id: job.outputLease.id }, data: { state: ArtifactUploadLeaseState.Finalized, finalizedAt: now } });
			await transaction.artifactPreprocessJob.update({ where: { id: job.id }, data: { derivedRevisionId: request.derivedRevisionId, completionDigest: request.receiptDigest } });
			return { status: "completed" };
		}
	}

	/** Records a current worker failure and applies bounded retry or terminal policy. */
	async failAtomically(command: ArtifactPreprocessorFailureCommand): Promise<FailArtifactPreprocessJobResult>
	{
		{
			const transaction = this.transaction;
			const now = await this._databaseNow();
			const job = await transaction.artifactPreprocessJob.findUnique({ where: { id: command.jobId } });
			if (job === null)
			{
				return { status: "conflict", reason: "claim_not_found" };
			}
			if (job.state !== ArtifactPreprocessJobState.Claimed || job.deliveryCount !== command.attempt || job.claimFence !== command.claimFence || job.claimExpiresAt === null || job.claimExpiresAt <= now)
			{
				return { status: "conflict", reason: "stale_claim" };
			}

			const terminal = job.deliveryCount >= _MAX_ATTEMPTS;
			const state = terminal ? ArtifactPreprocessJobState.TerminalFailed : ArtifactPreprocessJobState.RetryableFailed;
			const nextAttemptAt = terminal ? null : new Date(now.getTime() + _RETRY_DELAY_MILLISECONDS * job.deliveryCount);
			await transaction.artifactPreprocessJob.update({
				where: { id: job.id },
				data: { state, outputLeaseId: null, failureCode: command.failureCode, nextAttemptAt },
			});
			return { status: terminal ? "terminal" : "retryable" };
		}
	}

	/** Reads one database-owned wall-clock sample through the read-only Prisma view. */
	private async _databaseNow(): Promise<Date>
	{
		const clock = await this.transaction.artifactAuthorityClock.findUnique({ where: { singleton: 1 }, select: { now: true } });
		if (clock === null || !(clock.now instanceof Date) || Number.isNaN(clock.now.getTime()))
		{
			throw new Error("artifact authority database clock unavailable");
		}
		return clock.now;
	}
}

/** Check a Postgres bigint fits in a JavaScript safe integer, so converting it for JSON cannot silently change the number. */
function _IsSafeByteLength(value: bigint): boolean
{
	return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER);
}

/** Build the write-lease claims for the converted text, including the revision id derived from the lease id. */
function _OutputLeaseProjection(jobId: string, attempt: number, claimFence: string, artifactId: string, leaseId: string, siloId: string, expiresAt: Date, contentAddress: string, byteLength: number): ArtifactPreprocessOutputLeaseProjection
{
	return { jobId, attempt, claimFence, derivedRevisionId: _DerivedRevisionId(leaseId), writeLease: { leaseId, siloId, artifactId, action: "artifact.write" as const, expiresAtEpochSeconds: Math.floor(expiresAt.getTime() / 1_000), expectedContentAddress: contentAddress, expectedByteLength: byteLength, mediaType: "text/plain" } };
}

/** Check the receipt's lease id, hash, size, and media type all match the stored lease row, and that the media type is text/plain. */
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

/** Build the output revision id from its lease id, so completion can prove the receipt belongs to the same lease this attempt was given. */
function _DerivedRevisionId(leaseId: string): string
{
	return `artifact-preprocess:${leaseId}`;
}
