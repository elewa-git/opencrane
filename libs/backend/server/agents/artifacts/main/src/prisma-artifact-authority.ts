import { randomUUID } from "node:crypto";

import { ArtifactState, ArtifactUploadLeaseState, type Prisma } from "@prisma/client";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { __AdmitArtifactPreprocessWorkflow, __ArtifactPreprocessWorkflowTaskKey } from "./artifact-preprocess-workflow-admission";
import type { ArtifactAuthorityRepository, AtomicFinalizeArtifactResult, FinalizeArtifactRevisionCommand } from "./artifact-finalization.types";
import type { ArtifactUploadLeaseRepository, VerifiedArtifactUploadCommand } from "./artifact-upload.types";

/** First deterministic preprocessing pipeline scheduled for every published PDF source revision. */
const _PDF_TO_TEXT_PIPELINE_VERSION = "pdf-to-text/v1";

/**
 * Runs the publication SQL inside a transaction someone else already opened.
 *
 * Built once per attempt by `PrismaArtifactPublicationUnitOfWork` and handed the transaction
 * client. It cannot open, commit, or roll back anything, so a rolled-back attempt simply throws
 * this instance away rather than leaving it holding a dead client.
 *
 * One object serves as both repositories in `ArtifactPublicationTransaction`.
 *
 * Called by: `PrismaArtifactPublicationUnitOfWork.run` in
 * prisma-artifact-publication-unit-of-work.ts.
 */
export class PrismaArtifactAuthorityRepository implements ArtifactAuthorityRepository, ArtifactUploadLeaseRepository
{
	/** The already-open transaction to run every query against. This class cannot start or commit one. */
	private readonly transaction: Prisma.TransactionClient;
	/** Declared engine that saves a PDF conversion task through this same transaction. */
	private readonly workflow: Pick<IWorkflowEngine, "spawn">;

	/** Creates the repository for one already-open artifact publication transaction. */
	constructor(transaction: Prisma.TransactionClient, workflow: Pick<IWorkflowEngine, "spawn">)
	{
		this.transaction = transaction;
		this.workflow = workflow;
	}

	/**
	 * Creates the write lease for this upload, or returns the existing one for the same replay key.
	 *
	 * The replay key (`capabilityJti`) has a unique index, so a repeated request finds the same row
	 * instead of issuing a second lease over the same bytes.
	 *
	 * @param command - Upload facts without the finalization-only fields.
	 * @returns `issued` with the lease claims; `artifact_not_found` when there is no Active artifact
	 *   at those ids in that silo; `conflict` when a lease exists for this replay key but is no
	 *   longer Active, has expired, or was issued for a different artifact, silo, hash, size, media
	 *   type, or expiry.
	 * @throws Error when the database clock row cannot be read, because expiry would otherwise be
	 *   judged against process time.
	 */
	async issueLeaseAtomically(command: Omit<VerifiedArtifactUploadCommand, "bytes" | "createdBy" | "revision" | "artifactRevisionId" | "provenance" | "idempotencyKey">): ReturnType<ArtifactUploadLeaseRepository["issueLeaseAtomically"]>
	{
		// 1. Read the active logical artifact from the serializable transaction snapshot.
		const artifact = await this.transaction.artifact.findFirst({ where: { id: command.artifactId, siloId: command.siloId, state: ArtifactState.Active } });
		if (artifact === null) return { status: "artifact_not_found" };

		// 2. Replay the same valid capability deterministically instead of creating parallel write authority.
		const now = await this._databaseNow();
		const existing = await this.transaction.artifactUploadLease.findUnique({ where: { capabilityJti: command.capabilityJti } });
		if (existing !== null)
		{
			if (existing.state !== ArtifactUploadLeaseState.Active || existing.expiresAt <= now || existing.artifactId !== command.artifactId || existing.siloId !== command.siloId || existing.expectedContentAddress !== command.expectedContentAddress || existing.expectedByteLength !== BigInt(command.expectedByteLength) || existing.mediaType !== command.mediaType || Math.floor(existing.expiresAt.getTime() / 1_000) !== command.expiresAtEpochSeconds) return { status: "conflict" };
			return { status: "issued", lease: { leaseId: existing.id, siloId: existing.siloId, artifactId: existing.artifactId, action: "artifact.write", expiresAtEpochSeconds: Math.floor(existing.expiresAt.getTime() / 1_000), expectedContentAddress: existing.expectedContentAddress, expectedByteLength: Number(existing.expectedByteLength), mediaType: existing.mediaType } };
		}

		// 3. Persist only the exact proof facts that artifact-service must later reflect in its receipt.
		const lease = await this.transaction.artifactUploadLease.create({ data: { id: randomUUID(), artifactId: command.artifactId, siloId: command.siloId, capabilityJti: command.capabilityJti, expectedContentAddress: command.expectedContentAddress, expectedByteLength: BigInt(command.expectedByteLength), mediaType: command.mediaType, expiresAt: new Date(command.expiresAtEpochSeconds * 1_000) } });
		return { status: "issued", lease: { leaseId: lease.id, siloId: lease.siloId, artifactId: lease.artifactId, action: "artifact.write", expiresAtEpochSeconds: Math.floor(lease.expiresAt.getTime() / 1_000), expectedContentAddress: lease.expectedContentAddress, expectedByteLength: Number(lease.expectedByteLength), mediaType: lease.mediaType } };
	}

	/**
	 * Publishes the revision and spends its lease, in a fixed order that survives a retry.
	 *
	 * Recognises a replay from the outbox first, so a repeat commits nothing. Then records the
	 * promotion on the lease before creating the revision, schedules a text-conversion job when the
	 * media type is `application/pdf`, and writes the outbox event last so nothing outside the
	 * database can see the revision before it is fully committed.
	 *
	 * @param command - Validated revision metadata plus the verified promotion receipt.
	 * @returns One of the statuses in {@link AtomicFinalizeArtifactResult}.
	 * @throws Error when the database clock row cannot be read.
	 */
	async finalizeRevisionAtomically(command: FinalizeArtifactRevisionCommand): Promise<AtomicFinalizeArtifactResult>
	{
		// 1. If the outbox already holds this idempotency key for the same artifact and revision, this is a repeat: report success and write nothing.
		const existingOutbox = await this.transaction.artifactOutboxEvent.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
		if (existingOutbox !== null && existingOutbox.artifactId === command.artifactId && existingOutbox.revisionId === command.artifactRevisionId) return { status: "idempotent" };

		const artifact = await this.transaction.artifact.findFirst({ where: { id: command.artifactId, state: ArtifactState.Active }, select: { id: true, siloId: true } });
		if (artifact === null) return { status: "artifact_not_found" };
		const lease = await this.transaction.artifactUploadLease.findUnique({ where: { id: command.promotion.leaseId } });
		const now = await this._databaseNow();
		if (lease === null || lease.artifactId !== command.artifactId || lease.expiresAt <= now) return { status: "lease_not_found" };
		if (lease.state !== ArtifactUploadLeaseState.Active) return { status: "receipt_consumed" };
		if (lease.expectedContentAddress !== command.promotion.contentAddress || lease.expectedByteLength !== BigInt(command.promotion.byteLength) || lease.mediaType !== command.promotion.mediaType) return { status: "conflict" };

		// 2. Mark the lease Promoted before creating the revision, so the record of which receipt stored these bytes exists before anything points at them.
		await this.transaction.artifactUploadLease.update({ where: { id: lease.id }, data: { state: ArtifactUploadLeaseState.Promoted, promotionReceiptDigest: command.promotion.receiptDigest, promotedContentAddress: command.promotion.contentAddress, promotedByteLength: BigInt(command.promotion.byteLength), promotedAt: now } });
		await this.transaction.artifactRevision.create({ data: { id: command.artifactRevisionId, artifactId: command.artifactId, revision: command.revision, contentAddress: command.promotion.contentAddress, byteLength: BigInt(command.promotion.byteLength), mediaType: command.promotion.mediaType, provenance: command.provenance as Prisma.InputJsonValue, createdBy: command.createdBy } });
		await this.transaction.artifact.update({ where: { id: command.artifactId }, data: { currentRevisionId: command.artifactRevisionId } });

		// 3. Save the PDF-to-text record and its remote task before the outbox event, so the same commit
		// either publishes the source together with its conversion task or publishes neither.
		if (command.promotion.mediaType === "application/pdf")
		{
			const preprocessJobId = randomUUID();
			const preprocess = { preprocessJobId, siloId: artifact.siloId, sourceRevisionId: command.artifactRevisionId };
			await this.transaction.artifactPreprocessJob.create({ data: { id: preprocessJobId, sourceRevisionId: command.artifactRevisionId, pipelineVersion: _PDF_TO_TEXT_PIPELINE_VERSION } });
			await __AdmitArtifactPreprocessWorkflow({ workflowTransaction: { client: this.transaction } }, this.workflow, { ...preprocess, taskKey: __ArtifactPreprocessWorkflowTaskKey(preprocess) });
		}

		// 4. Write the outbox event and mark the lease Finalized in the same commit, so a retry cannot publish twice or spend the receipt twice.
		await this.transaction.artifactOutboxEvent.create({ data: { artifactId: command.artifactId, revisionId: command.artifactRevisionId, kind: "RevisionPublished", idempotencyKey: command.idempotencyKey, payload: { contentAddress: command.promotion.contentAddress, byteLength: command.promotion.byteLength, mediaType: command.promotion.mediaType } } });
		await this.transaction.artifactUploadLease.update({ where: { id: lease.id }, data: { state: ArtifactUploadLeaseState.Finalized, finalizedAt: now } });
		return { status: "finalized" };
	}

	/**
	 * Reads the current time from the database rather than this process.
	 *
	 * Lease expiry must be judged by one clock. A pod whose clock runs behind would otherwise
	 * accept an expired lease.
	 *
	 * @returns The database's current timestamp.
	 * @throws Error when the clock view returns no usable row, which fails the whole operation
	 *   rather than falling back to process time.
	 */
	private async _databaseNow(): Promise<Date>
	{
		const clock = await this.transaction.artifactAuthorityClock.findUnique({ where: { singleton: 1 }, select: { now: true } });
		if (clock === null || !(clock.now instanceof Date) || Number.isNaN(clock.now.getTime())) throw new Error("artifact authority database clock unavailable");
		return clock.now;
	}
}
