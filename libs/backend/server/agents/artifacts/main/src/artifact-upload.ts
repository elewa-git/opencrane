import { ___DoWithTrace } from "@opencrane/observability";

import { __FinalizeArtifactRevision } from "./artifact-finalization.js";
import type { ArtifactAuthorityRepository } from "./artifact-finalization.types.js";
import type { ArtifactServicePromotionPort, ArtifactUploadCryptoPort, ArtifactUploadLeaseRepository, ArtifactUploadResult, VerifiedArtifactUploadCommand } from "./artifact-upload.types.js";

/** Execute a proof-authorized upload without giving artifact-service catalog authority. */
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
