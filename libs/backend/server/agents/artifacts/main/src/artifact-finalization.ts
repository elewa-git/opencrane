import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";

import type { ArtifactAuthorityRepository, FinalizeArtifactRevisionCommand, FinalizeArtifactRevisionResult } from "./artifact-finalization.types.js";

/**
 * Make already-stored bytes visible: write the revision row and its publication event.
 *
 * The second of the two upload transactions. Everything is checked before the database is
 * touched, then the revision, the artifact's current-revision pointer, the receipt consumption,
 * and the outbox event all commit together. No bytes are read or written here.
 *
 * Called by: `__UploadArtifact` in artifact-upload.ts. Exported from the package barrel, but no
 * caller outside this package uses it directly.
 *
 * @param repository - The persistence port that owns the transaction.
 * @param command - Revision metadata plus the verified promotion receipt.
 * @returns `finalized` with `idempotent: false` on the first commit and `idempotent: true` when
 *   the same idempotency key already produced this exact revision, so a retry after a lost
 *   response is safe. A `denied` result names which check failed and means nothing was written.
 */
export async function __FinalizeArtifactRevision(repository: ArtifactAuthorityRepository, command: FinalizeArtifactRevisionCommand): Promise<FinalizeArtifactRevisionResult>
{
	// 1. Check every field, including the receipt's hash, size, and media type, before touching the database.
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

	// 2. Commit the revision row, the current-revision pointer, the spent receipt, and the outbox event. No bytes move here.
	const result = await repository.finalizeRevisionAtomically(command);

	// 3. Report a repeat of the same commit as success, but refuse a receipt that was already spent or no longer matches its lease.
	if (result.status === "finalized") return { outcome: "finalized", idempotent: false };
	if (result.status === "idempotent") return { outcome: "finalized", idempotent: true };
	return { outcome: "denied", reason: result.status };
}
