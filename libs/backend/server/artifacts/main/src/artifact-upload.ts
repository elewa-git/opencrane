import { ___DoWithTrace } from "@opencrane/observability";

import { __FinalizeArtifactRevision } from "./artifact-finalization.js";
import type { ArtifactAuthorityRepository } from "./artifact-finalization.types.js";
import type { ArtifactServicePromotionPort, ArtifactUploadCryptoPort, ArtifactUploadLeaseRepository, ArtifactUploadResult, VerifiedArtifactUploadCommand } from "./artifact-upload.types.js";

/**
 * Executes a proof-authorized upload without giving artifact-service catalog authority.
 *
 * The catalog creates one durable lease before handing bytes to artifact-service, then accepts only
 * a receipt that is cryptographically bound to that lease's exact digest, byte length, and media
 * type. This prevents a transport service from choosing catalog state or a replayed receipt from
 * finalizing a different artifact revision.
 */
export async function __UploadArtifact(repository: ArtifactUploadLeaseRepository & ArtifactAuthorityRepository, service: ArtifactServicePromotionPort, crypto: ArtifactUploadCryptoPort, command: VerifiedArtifactUploadCommand): Promise<ArtifactUploadResult>
{
	// 1. Atomically issue or recover the capability-JTI lease before bytes leave the authority.
	const issued = await repository.issueLeaseAtomically(command);
	if (issued.status !== "issued") return { outcome: "denied", reason: "lease_issue_failed" };

	// 2. Delegate storage to the narrow service port; tracing joins catalog authority to CAS I/O.
	const receipt = await ___DoWithTrace("artifact.upload.promote", { artifactId: command.artifactId, leaseId: issued.lease.leaseId }, function _promote()
	{
		return service.promote(crypto.signLease(issued.lease), command.bytes);
	});

	// 3. Require the signed receipt to restate every lease-bound storage fact before finalization.
	const promotion = crypto.verifyReceipt(receipt.receipt);
	if (promotion === null || promotion.leaseId !== issued.lease.leaseId || promotion.contentAddress !== issued.lease.expectedContentAddress || promotion.byteLength !== issued.lease.expectedByteLength || promotion.mediaType !== issued.lease.mediaType)
	{
		return { outcome: "denied", reason: "promotion_invalid" };
	}
	// 4. Consume the verified receipt in the same authority that publishes immutable catalog state.
	const finalized = await __FinalizeArtifactRevision(repository, { artifactId: command.artifactId, revision: command.revision, artifactRevisionId: command.artifactRevisionId, createdBy: command.createdBy, provenance: command.provenance, idempotencyKey: command.idempotencyKey, promotion: { ...promotion, receiptDigest: crypto.digestReceipt(receipt.receipt) } });
	return finalized.outcome === "finalized" ? finalized : { outcome: "denied", reason: "finalization_failed" };
}
