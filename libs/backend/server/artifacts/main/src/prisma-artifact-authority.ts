import { randomUUID } from "node:crypto";

import { ArtifactUploadLeaseState, Prisma, type PrismaClient } from "@prisma/client";

import type { ArtifactAuthorityRepository, AtomicFinalizeArtifactResult, FinalizeArtifactRevisionCommand } from "./artifact-finalization.types.js";
import type { ArtifactUploadLeaseRepository, VerifiedArtifactUploadCommand } from "./artifact-upload.types.js";

/** Postgres authority for receipt consumption, immutable revision publication, and outbox creation. */
export class PrismaArtifactAuthorityRepository implements ArtifactAuthorityRepository, ArtifactUploadLeaseRepository
{
	/** Canonical OpenCrane catalog database client. */
	private readonly prisma: PrismaClient;

	/** Creates the artifact authority adapter over the product Postgres authority. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Creates or returns the one durable, proof-bound lease for one exact capability JTI. */
	async issueLeaseAtomically(command: Omit<VerifiedArtifactUploadCommand, "bytes" | "createdBy" | "revision" | "artifactRevisionId" | "provenance" | "idempotencyKey">): Promise<Awaited<ReturnType<ArtifactUploadLeaseRepository["issueLeaseAtomically"]>>>
	{
		try
		{
			return await this.prisma.$transaction(async function _issue(transaction: Prisma.TransactionClient)
			{
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "artifacts" WHERE "id" = ${command.artifactId} FOR UPDATE`);
				const artifact = await transaction.artifact.findUnique({ where: { id: command.artifactId } });
				if (artifact === null || artifact.state !== "Active" || artifact.siloId !== command.siloId) return { status: "artifact_not_found" } as const;
				const existing = await transaction.artifactUploadLease.findUnique({ where: { capabilityJti: command.capabilityJti } });
				if (existing !== null)
				{
					if (existing.state !== ArtifactUploadLeaseState.Active || existing.expiresAt <= new Date() || existing.artifactId !== command.artifactId || existing.siloId !== command.siloId || existing.expectedContentAddress !== command.expectedContentAddress || existing.expectedByteLength !== BigInt(command.expectedByteLength) || existing.mediaType !== command.mediaType || Math.floor(existing.expiresAt.getTime() / 1_000) !== command.expiresAtEpochSeconds) return { status: "conflict" } as const;
					return { status: "issued", lease: { leaseId: existing.id, siloId: existing.siloId, artifactId: existing.artifactId, action: "artifact.write", expiresAtEpochSeconds: Math.floor(existing.expiresAt.getTime() / 1_000), expectedContentAddress: existing.expectedContentAddress, expectedByteLength: Number(existing.expectedByteLength), mediaType: existing.mediaType } } as const;
				}
				const lease = await transaction.artifactUploadLease.create({ data: { id: randomUUID(), artifactId: command.artifactId, siloId: command.siloId, capabilityJti: command.capabilityJti, expectedContentAddress: command.expectedContentAddress, expectedByteLength: BigInt(command.expectedByteLength), mediaType: command.mediaType, expiresAt: new Date(command.expiresAtEpochSeconds * 1_000) } });
				return { status: "issued", lease: { leaseId: lease.id, siloId: lease.siloId, artifactId: lease.artifactId, action: "artifact.write", expiresAtEpochSeconds: Math.floor(lease.expiresAt.getTime() / 1_000), expectedContentAddress: lease.expectedContentAddress, expectedByteLength: Number(lease.expectedByteLength), mediaType: lease.mediaType } } as const;
			});
		}
		catch (error)
		{
			if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) return { status: "conflict" };
			throw error;
		}
	}

	/** Consumes one exact service receipt and publishes its immutable revision atomically. */
	async finalizeRevisionAtomically(command: FinalizeArtifactRevisionCommand): Promise<AtomicFinalizeArtifactResult>
	{
		try
		{
			return await this.prisma.$transaction(async function _finalize(transaction: Prisma.TransactionClient)
			{
				// 1. Lock the artifact and lease first: every path serializes on the same catalog authority.
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "artifacts" WHERE "id" = ${command.artifactId} FOR UPDATE`);
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "artifact_upload_leases" WHERE "id" = ${command.promotion.leaseId} FOR UPDATE`);
				const existingOutbox = await transaction.artifactOutboxEvent.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
				if (existingOutbox !== null && existingOutbox.artifactId === command.artifactId && existingOutbox.revisionId === command.artifactRevisionId)
				{
					return { status: "idempotent" } as const;
				}

				const artifact = await transaction.artifact.findUnique({ where: { id: command.artifactId } });
				if (artifact === null || artifact.state !== "Active") return { status: "artifact_not_found" } as const;
				const lease = await transaction.artifactUploadLease.findUnique({ where: { id: command.promotion.leaseId } });
				if (lease === null || lease.artifactId !== command.artifactId || lease.expiresAt <= new Date()) return { status: "lease_not_found" } as const;
				if (lease.state !== ArtifactUploadLeaseState.Active) return { status: "receipt_consumed" } as const;
				if (lease.expectedContentAddress !== command.promotion.contentAddress || lease.expectedByteLength !== BigInt(command.promotion.byteLength) || lease.mediaType !== command.promotion.mediaType)
				{
					return { status: "conflict" } as const;
				}

				// 2. Record promotion before finalization so database lifecycle triggers preserve receipt immutability.
				await transaction.artifactUploadLease.update({
					where: { id: lease.id },
					data: { state: ArtifactUploadLeaseState.Promoted, promotionReceiptDigest: command.promotion.receiptDigest, promotedContentAddress: command.promotion.contentAddress, promotedByteLength: BigInt(command.promotion.byteLength), promotedAt: new Date() },
				});
				await transaction.artifactRevision.create({
					data: { id: command.artifactRevisionId, artifactId: command.artifactId, revision: command.revision, contentAddress: command.promotion.contentAddress, byteLength: BigInt(command.promotion.byteLength), mediaType: command.promotion.mediaType, provenance: command.provenance as Prisma.InputJsonValue, createdBy: command.createdBy },
				});
				await transaction.artifact.update({ where: { id: command.artifactId }, data: { currentRevisionId: command.artifactRevisionId } });
				await transaction.artifactOutboxEvent.create({
					data: { artifactId: command.artifactId, revisionId: command.artifactRevisionId, kind: "RevisionPublished", idempotencyKey: command.idempotencyKey, payload: { contentAddress: command.promotion.contentAddress, byteLength: command.promotion.byteLength, mediaType: command.promotion.mediaType } },
				});
				await transaction.artifactUploadLease.update({ where: { id: lease.id }, data: { state: ArtifactUploadLeaseState.Finalized, finalizedAt: new Date() } });
				return { status: "finalized" } as const;
			});
		}
		catch (error)
		{
			if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) return { status: "conflict" };
			throw error;
		}
	}
}
