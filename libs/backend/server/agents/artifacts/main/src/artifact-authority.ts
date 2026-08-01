import type { ArtifactAuthorityRepository } from "./artifact-finalization.types.js";
import type { ArtifactPublicationUnitOfWork } from "./artifact-unit-of-work.types.js";
import type { ArtifactUploadLeaseRepository, VerifiedArtifactUploadCommand } from "./artifact-upload.types.js";
import { _ArtifactPublicationConflictError } from "./prisma-artifact-publication-unit-of-work.js";

/** Coordinates short, independent durable transactions around an external byte-store promotion. */
export class _ArtifactUploadAuthority implements ArtifactAuthorityRepository, ArtifactUploadLeaseRepository
{
	/** Opaque boundary that alone owns database transaction creation. */
	private readonly unitOfWork: ArtifactPublicationUnitOfWork;

	/** Creates the transaction-owning facade used by upload and finalization workflows. */
	constructor(unitOfWork: ArtifactPublicationUnitOfWork)
	{
		this.unitOfWork = unitOfWork;
	}

	/** Reserves one exact proof-bound write lease before the external promotion begins. */
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

	/** Commits the verified receipt, immutable revision, and outbox in one isolated transaction. */
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
