import { ___DoWithTrace } from "@opencrane/backend/observability";

import { __FinalizeArtifactRevision } from "./artifact-finalization.js";
import type { ArtifactAuthorityRepository } from "./artifact-finalization.types.js";
import type { ArtifactServicePromotionPort, ArtifactUploadCryptoPort, ArtifactUploadLeaseRepository, ArtifactUploadResult, VerifiedArtifactUploadCommand } from "./artifact-upload.types.js";

/**
 * Run one already-authorized upload: reserve, promote, commit.
 *
 * Two short database transactions with an external call in between, so no transaction is held
 * open while bytes are in flight. First reserve a write lease bound to the expected hash, size,
 * and media type. Then stream the bytes to the private artifact service and check its receipt
 * against that lease field by field - a receipt that verifies but names a different lease, hash,
 * size, or media type is refused. Only then commit the revision.
 *
 * The artifact service never writes catalogue rows: it stores bytes and signs a receipt, and
 * this function decides what becomes visible. That is why the receipt is re-checked here rather
 * than trusted.
 *
 * Called by: `_CreateArtifactUploadGateway` in
 * apps/opencrane/src/infra/artifacts/artifact-upload.factory.ts, which apps/opencrane/src/index.ts
 * attaches as `publicApp.locals.artifactUploadGateway`.
 *
 * @param repository - Provides both transactions: lease reservation and revision commit.
 * @param service - Streams the bytes to the private artifact service.
 * @param crypto - Signs the lease, verifies the receipt, and digests it.
 * @param command - An upload whose authorization was already verified by the caller.
 * @returns `finalized` when the revision is visible, else a denial. Read
 *   {@link ArtifactUploadResult} before handling a denial: two of the three leave promoted bytes
 *   in storage with nothing pointing at them.
 * @throws Whatever the artifact service or the crypto port throws. The bytes may already be
 *   stored when that happens, so a caller must not treat a throw as "nothing happened".
 */
export async function __UploadArtifact(repository: ArtifactUploadLeaseRepository & ArtifactAuthorityRepository, service: ArtifactServicePromotionPort, crypto: ArtifactUploadCryptoPort, command: VerifiedArtifactUploadCommand): Promise<ArtifactUploadResult>
{
	const issued = await repository.issueLeaseAtomically(command);
	if (issued.status !== "issued") return { outcome: "denied", reason: "lease_issue_failed" };
	const receipt = await ___DoWithTrace("artifact.upload.promote", { artifactId: command.artifactId, leaseId: issued.lease.leaseId }, function _promote()
	{
		return service.promote(crypto.signLease(issued.lease), command.bytes);
	});
	const promotion = crypto.verifyReceipt(receipt.receipt);
	if (promotion === null || promotion.leaseId !== issued.lease.leaseId || promotion.contentAddress !== issued.lease.expectedContentAddress || promotion.byteLength !== issued.lease.expectedByteLength || promotion.mediaType !== issued.lease.mediaType)
	{
		return { outcome: "denied", reason: "promotion_invalid" };
	}
	const finalized = await __FinalizeArtifactRevision(repository, { artifactId: command.artifactId, revision: command.revision, artifactRevisionId: command.artifactRevisionId, createdBy: command.createdBy, provenance: command.provenance, idempotencyKey: command.idempotencyKey, promotion: { ...promotion, receiptDigest: crypto.digestReceipt(receipt.receipt) } });
	return finalized.outcome === "finalized" ? finalized : { outcome: "denied", reason: "finalization_failed" };
}
