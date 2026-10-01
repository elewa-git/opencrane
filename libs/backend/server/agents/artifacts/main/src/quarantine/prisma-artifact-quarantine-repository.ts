import { ArtifactRevisionState, ArtifactState, ArtifactUploadLeaseState, type Prisma } from "@prisma/client";

import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ArtifactQuarantineOutcomes, type ArtifactQuarantineRepository, type QuarantineArtifactRevisionCommand } from "./artifact-quarantine.types";

/** Consumes a verified upload receipt and admits its immutable bytes to the existing scanner. */
export class PrismaArtifactQuarantineRepository implements ArtifactQuarantineRepository
{
	/** Keep the lease, revision and scan writes inside the asset owner's transaction. */
	constructor(private readonly transaction: Prisma.TransactionClient) {}

	/**
	 * A retry must match both the saved receipt and the complete revision identity.
	 * Only the scanner may publish the revision or change the artifact's current pointer.
	 */
	async finalize(command: QuarantineArtifactRevisionCommand): Promise<ArtifactQuarantineOutcomes>
	{
		if (!_ValidCommand(command))
			return ArtifactQuarantineOutcomes.Denied;
		const artifact = await this.transaction.artifact.findFirst({ where: { id: command.artifactId, siloId: command.siloId, state: ArtifactState.Active }, select: { id: true } });
		const lease = await this.transaction.artifactUploadLease.findUnique({ where: { id: command.promotion.leaseId } });
		if (artifact === null || lease === null || lease.siloId !== command.siloId || lease.artifactId !== command.artifactId
			|| lease.expectedContentAddress !== command.promotion.contentAddress || lease.expectedByteLength !== BigInt(command.promotion.byteLength) || lease.mediaType !== command.promotion.mediaType)
			return ArtifactQuarantineOutcomes.Denied;

		const revision = await this.transaction.artifactRevision.findUnique({ where: { id: command.artifactRevisionId }, include: { scanJob: { select: { artifactRevisionId: true } } } });
		if (revision !== null)
		{
			const sameRevision = revision.artifactId === command.artifactId && revision.revision === 1 && revision.createdBy === command.createdBy
				&& revision.contentAddress === command.promotion.contentAddress && revision.byteLength === BigInt(command.promotion.byteLength) && revision.mediaType === command.promotion.mediaType
				&& ___DigestCanonicalJson(revision.provenance as JsonValue) === ___DigestCanonicalJson(command.provenance) && revision.scanJob?.artifactRevisionId === revision.id;
			const sameReceipt = lease.state === ArtifactUploadLeaseState.Finalized && lease.promotionReceiptDigest === command.promotion.receiptDigest
				&& lease.promotedContentAddress === command.promotion.contentAddress && lease.promotedByteLength === BigInt(command.promotion.byteLength);
			return sameRevision && sameReceipt ? ArtifactQuarantineOutcomes.Idempotent : ArtifactQuarantineOutcomes.Denied;
		}

		const clock = await this.transaction.artifactAuthorityClock.findUnique({ where: { singleton: 1 }, select: { now: true } });
		if (clock === null || !(clock.now instanceof Date) || !Number.isFinite(clock.now.getTime()))
			throw new Error("Artifact quarantine database clock unavailable");
		if (lease.state !== ArtifactUploadLeaseState.Active || lease.expiresAt <= clock.now)
			return ArtifactQuarantineOutcomes.Denied;

		// Spending the current lease first makes a competing finalization roll back the whole attempt.
		const claimed = await this.transaction.artifactUploadLease.updateMany({
			where: { id: lease.id, state: ArtifactUploadLeaseState.Active, expiresAt: { gt: clock.now } },
			data: { state: ArtifactUploadLeaseState.Promoted, promotionReceiptDigest: command.promotion.receiptDigest, promotedContentAddress: command.promotion.contentAddress, promotedByteLength: BigInt(command.promotion.byteLength), promotedAt: clock.now },
		});
		if (claimed.count !== 1)
			throw new Error("Artifact quarantine lost its upload lease");
		await this.transaction.artifactRevision.create({ data: {
			id: command.artifactRevisionId, artifactId: command.artifactId, revision: 1, state: ArtifactRevisionState.Quarantined,
			contentAddress: command.promotion.contentAddress, byteLength: BigInt(command.promotion.byteLength), mediaType: command.promotion.mediaType,
			provenance: command.provenance as Prisma.InputJsonValue, createdBy: command.createdBy,
		} });
		await this.transaction.artifactScanJob.create({ data: { artifactRevisionId: command.artifactRevisionId } });
		await this.transaction.artifactUploadLease.update({ where: { id: lease.id }, data: { state: ArtifactUploadLeaseState.Finalized, finalizedAt: clock.now } });
		return ArtifactQuarantineOutcomes.Accepted;
	}
}

/** Reject malformed receipt facts before BigInt conversion or any database work. */
function _ValidCommand(command: QuarantineArtifactRevisionCommand): boolean
{
	const receipt = command.promotion;
	return [command.siloId, command.artifactId, command.artifactRevisionId, command.createdBy, receipt.leaseId].every(value => typeof value === "string" && value.trim().length > 0)
		&& ___IsSha256ContentAddress(receipt.contentAddress) && ___IsSha256ContentAddress(receipt.receiptDigest)
		&& Number.isSafeInteger(receipt.byteLength) && receipt.byteLength > 0 && receipt.mediaType.includes("/")
		&& command.provenance !== null && typeof command.provenance === "object" && !Array.isArray(command.provenance);
}
