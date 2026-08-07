import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";

import type { ArtifactAuthorityRepository, FinalizeArtifactRevisionCommand, FinalizeArtifactRevisionResult } from "./artifact-finalization.types.js";

/** Finalizes ArtifactStore-promoted bytes into canonical metadata and an outbox event. */
export async function __FinalizeArtifactRevision(repository: ArtifactAuthorityRepository, command: FinalizeArtifactRevisionCommand): Promise<FinalizeArtifactRevisionResult>
{
	// 1. Validate storage-neutral metadata and authenticated receipt coordinates before persistence.
	const validPromotion = command.promotion.leaseId.trim()
		&& ___IsSha256ContentAddress(command.promotion.contentAddress)
		&& Number.isSafeInteger(command.promotion.byteLength)
		&& command.promotion.byteLength >= 0
		&& command.promotion.mediaType.includes("/")
		&& ___IsSha256ContentAddress(command.promotion.receiptDigest);
	if (!command.artifactId.trim() || !command.artifactRevisionId.trim() || !Number.isSafeInteger(command.revision) || command.revision < 1 || !command.createdBy.trim() || !command.idempotencyKey.trim() || !validPromotion)
	{
		return { outcome: "denied", reason: "invalid_command" };
	}

	// 2. Commit only metadata, current pointer, receipt consumption, and outbox; bytes stay behind ArtifactStore.
	const result = await repository.finalizeRevisionAtomically(command);

	// 3. Expose idempotent success while keeping stale or replayed receipts fail closed.
	if (result.status === "finalized") return { outcome: "finalized", idempotent: false };
	if (result.status === "idempotent") return { outcome: "finalized", idempotent: true };
	return { outcome: "denied", reason: result.status };
}
