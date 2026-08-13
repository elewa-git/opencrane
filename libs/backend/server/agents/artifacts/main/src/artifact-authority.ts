import type { ArtifactAuthorityRepository } from "./artifact-finalization.types.js";
import { _ArtifactPublicationConflictError, type ArtifactPublicationUnitOfWork } from "./artifact-unit-of-work.types.js";
import type { ArtifactUploadLeaseRepository, VerifiedArtifactUploadCommand } from "./artifact-upload.types.js";

/**
 * Runs each publication step in its own transaction, so none is held open while bytes are in flight.
 *
 * An upload is two short transactions with an external call between them: reserve the write
 * lease, promote the bytes through the artifact service, commit the revision. Holding one
 * transaction across the promotion would keep a serializable transaction open for the whole
 * upload, so each step gets its own instead. The gap is safe because the lease row carries the
 * expected hash, size, and media type, and the commit re-checks the receipt against it.
 *
 * If the second transaction fails, the bytes are already stored with no revision pointing at
 * them. Nothing here deletes them; the caller reports the failure and artifact-service cleanup
 * removes unreferenced bytes.
 *
 * Both methods turn {@link _ArtifactPublicationConflictError} into a `conflict` status, so the
 * application layer never sees a database-specific exception.
 *
 * Called by: `_CreateArtifactUploadAuthority` in prisma-artifact-authority.composition.ts.
 */
export class _ArtifactUploadAuthority implements ArtifactAuthorityRepository, ArtifactUploadLeaseRepository
{
	/** The only thing here allowed to open a transaction; this class asks it to run work rather than starting one itself. */
	private readonly unitOfWork: ArtifactPublicationUnitOfWork;

	/** Creates the transaction-owning facade used by upload and finalization workflows. */
	constructor(unitOfWork: ArtifactPublicationUnitOfWork)
	{
		this.unitOfWork = unitOfWork;
	}

	/**
	 * Reserves the write lease - the first transaction, before any bytes move.
	 *
	 * @param command - Upload facts without the finalization-only fields.
	 * @returns `issued` with the claims to sign, or `artifact_not_found`/`conflict`. A `conflict`
	 *   here also covers a database collision that exhausted its retries; either way nothing was
	 *   written and no bytes exist yet.
	 * @throws Any database error that is not a recognised rolled-back collision.
	 */
	async issueLeaseAtomically(command: Omit<VerifiedArtifactUploadCommand, "bytes" | "createdBy" | "revision" | "artifactRevisionId" | "provenance" | "idempotencyKey">): ReturnType<ArtifactUploadLeaseRepository["issueLeaseAtomically"]>
	{
		try
		{
			return await this.unitOfWork.run(async function _Issue(transaction)
			{
				return transaction.uploadLeases.issueLeaseAtomically(command);
			});
		}
		catch (error)
		{
			if (error instanceof _ArtifactPublicationConflictError) return { status: "conflict" };
			throw error;
		}
	}

	/**
	 * Commits the revision - the second transaction, after the bytes are stored.
	 *
	 * @param command - Validated revision metadata plus the verified promotion receipt.
	 * @returns One of the statuses in {@link AtomicFinalizeArtifactResult}; a retry collision that
	 *   exhausted its attempts arrives as `conflict`. Any non-success value means the promoted
	 *   bytes are now unreferenced.
	 * @throws Any database error that is not a recognised rolled-back collision.
	 */
	async finalizeRevisionAtomically(command: Parameters<ArtifactAuthorityRepository["finalizeRevisionAtomically"]>[0]): ReturnType<ArtifactAuthorityRepository["finalizeRevisionAtomically"]>
	{
		try
		{
			return await this.unitOfWork.run(async function _Finalize(transaction)
			{
				return transaction.revisions.finalizeRevisionAtomically(command);
			});
		}
		catch (error)
		{
			if (error instanceof _ArtifactPublicationConflictError) return { status: "conflict" };
			throw error;
		}
	}
}
