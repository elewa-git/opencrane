import { randomUUID } from "node:crypto";

import { ArtifactState, ArtifactUploadLeaseState, Prisma } from "@prisma/client";

import type { ArtifactAuthorityRepository, AtomicFinalizeArtifactResult, FinalizeArtifactRevisionCommand } from "./artifact-finalization.types.js";
import type { ArtifactUploadLeaseRepository, VerifiedArtifactUploadCommand } from "./artifact-upload.types.js";

/** First deterministic preprocessing pipeline scheduled for every published PDF source revision. */
const _PDF_TO_TEXT_PIPELINE_VERSION = "pdf-to-text/v1";

/** Transaction-scoped artifact publication repository; only its unit of work may construct it. */
export class PrismaArtifactAuthorityRepository implements ArtifactAuthorityRepository, ArtifactUploadLeaseRepository
{
	/** Private transaction client; this repository can never open or commit a transaction itself. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the repository for one already-open artifact publication transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Creates or reloads the one durable proof-bound lease for the exact capability JTI. */
	async issueLeaseAtomically(command: Omit<VerifiedArtifactUploadCommand, "bytes" | "createdBy" | "revision" | "artifactRevisionId" | "provenance" | "idempotencyKey">): ReturnType<ArtifactUploadLeaseRepository["issueLeaseAtomically"]>
	{
		// 1. Serialize on the logical artifact so concurrent proof uses share one catalogue authority.
		await this.transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "artifacts" WHERE "id" = ${command.artifactId} FOR UPDATE`);
		const artifact = await this.transaction.artifact.findUnique({ where: { id: command.artifactId } });
		if (artifact === null || artifact.state !== ArtifactState.Active || artifact.siloId !== command.siloId) return { status: "artifact_not_found" };

		// 2. Replay the same valid capability deterministically instead of creating parallel write authority.
		const existing = await this.transaction.artifactUploadLease.findUnique({ where: { capabilityJti: command.capabilityJti } });
		if (existing !== null)
		{
			if (existing.state !== ArtifactUploadLeaseState.Active || existing.expiresAt <= new Date() || existing.artifactId !== command.artifactId || existing.siloId !== command.siloId || existing.expectedContentAddress !== command.expectedContentAddress || existing.expectedByteLength !== BigInt(command.expectedByteLength) || existing.mediaType !== command.mediaType || Math.floor(existing.expiresAt.getTime() / 1_000) !== command.expiresAtEpochSeconds) return { status: "conflict" };
			return { status: "issued", lease: { leaseId: existing.id, siloId: existing.siloId, artifactId: existing.artifactId, action: "artifact.write", expiresAtEpochSeconds: Math.floor(existing.expiresAt.getTime() / 1_000), expectedContentAddress: existing.expectedContentAddress, expectedByteLength: Number(existing.expectedByteLength), mediaType: existing.mediaType } };
		}

		// 3. Persist only the exact proof facts that artifact-service must later reflect in its receipt.
		const lease = await this.transaction.artifactUploadLease.create({ data: { id: randomUUID(), artifactId: command.artifactId, siloId: command.siloId, capabilityJti: command.capabilityJti, expectedContentAddress: command.expectedContentAddress, expectedByteLength: BigInt(command.expectedByteLength), mediaType: command.mediaType, expiresAt: new Date(command.expiresAtEpochSeconds * 1_000) } });
		return { status: "issued", lease: { leaseId: lease.id, siloId: lease.siloId, artifactId: lease.artifactId, action: "artifact.write", expiresAtEpochSeconds: Math.floor(lease.expiresAt.getTime() / 1_000), expectedContentAddress: lease.expectedContentAddress, expectedByteLength: Number(lease.expectedByteLength), mediaType: lease.mediaType } };
	}

	/** Consumes one exact service receipt and publishes its immutable revision in this transaction. */
	async finalizeRevisionAtomically(command: FinalizeArtifactRevisionCommand): Promise<AtomicFinalizeArtifactResult>
	{
		// 1. Lock artifact and lease in the established order, then recognize an exact outbox replay.
		await this.transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "artifacts" WHERE "id" = ${command.artifactId} FOR UPDATE`);
		await this.transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "artifact_upload_leases" WHERE "id" = ${command.promotion.leaseId} FOR UPDATE`);
		const existingOutbox = await this.transaction.artifactOutboxEvent.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
		if (existingOutbox !== null && existingOutbox.artifactId === command.artifactId && existingOutbox.revisionId === command.artifactRevisionId) return { status: "idempotent" };

		const artifact = await this.transaction.artifact.findUnique({ where: { id: command.artifactId } });
		if (artifact === null || artifact.state !== ArtifactState.Active) return { status: "artifact_not_found" };
		const lease = await this.transaction.artifactUploadLease.findUnique({ where: { id: command.promotion.leaseId } });
		if (lease === null || lease.artifactId !== command.artifactId || lease.expiresAt <= new Date()) return { status: "lease_not_found" };
		if (lease.state !== ArtifactUploadLeaseState.Active) return { status: "receipt_consumed" };
		if (lease.expectedContentAddress !== command.promotion.contentAddress || lease.expectedByteLength !== BigInt(command.promotion.byteLength) || lease.mediaType !== command.promotion.mediaType) return { status: "conflict" };

		// 2. Persist promotion evidence before the revision so lifecycle triggers preserve immutable receipt lineage.
		await this.transaction.artifactUploadLease.update({ where: { id: lease.id }, data: { state: ArtifactUploadLeaseState.Promoted, promotionReceiptDigest: command.promotion.receiptDigest, promotedContentAddress: command.promotion.contentAddress, promotedByteLength: BigInt(command.promotion.byteLength), promotedAt: new Date() } });
		await this.transaction.artifactRevision.create({ data: { id: command.artifactRevisionId, artifactId: command.artifactId, revision: command.revision, contentAddress: command.promotion.contentAddress, byteLength: BigInt(command.promotion.byteLength), mediaType: command.promotion.mediaType, provenance: command.provenance as Prisma.InputJsonValue, createdBy: command.createdBy } });
		await this.transaction.artifact.update({ where: { id: command.artifactId }, data: { currentRevisionId: command.artifactRevisionId } });

		// 3. Record required derived work before the publication outbox makes the source externally observable.
		if (command.promotion.mediaType === "application/pdf") await this.transaction.artifactPreprocessJob.create({ data: { sourceRevisionId: command.artifactRevisionId, pipelineVersion: _PDF_TO_TEXT_PIPELINE_VERSION } });

		// 4. Publish the revision and consume the receipt together so no retry can duplicate either effect.
		await this.transaction.artifactOutboxEvent.create({ data: { artifactId: command.artifactId, revisionId: command.artifactRevisionId, kind: "RevisionPublished", idempotencyKey: command.idempotencyKey, payload: { contentAddress: command.promotion.contentAddress, byteLength: command.promotion.byteLength, mediaType: command.promotion.mediaType } } });
		await this.transaction.artifactUploadLease.update({ where: { id: lease.id }, data: { state: ArtifactUploadLeaseState.Finalized, finalizedAt: new Date() } });
		return { status: "finalized" };
	}
}
