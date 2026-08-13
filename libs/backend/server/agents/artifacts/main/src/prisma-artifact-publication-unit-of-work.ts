import { Prisma, type PrismaClient } from "@prisma/client";

import { PrismaArtifactAuthorityRepository } from "./prisma-artifact-authority.js";
import { _ArtifactPublicationConflictError, type ArtifactPublicationTransaction, type ArtifactPublicationUnitOfWork, type ArtifactPublicationWork } from "./artifact-unit-of-work.types.js";

/** Maximum complete transaction attempts for a catalogue race that PostgreSQL rolled back. */
const _PUBLICATION_ATTEMPT_LIMIT = 3;

/** Prisma conflict codes that prove the database rolled an attempt back before any durable effect. */
const _RETRYABLE_PUBLICATION_CODES = new Set(["P2002", "P2034"]);

/**
 * Opens one SERIALIZABLE transaction per publication step and retries safe collisions.
 *
 * Up to three complete attempts, with fresh transaction-scoped repositories each time. Only the
 * two codes in `_RETRYABLE_PUBLICATION_CODES` are retried, because they prove the attempt rolled
 * back with nothing written. When the last attempt still collides, the Prisma error is converted
 * into {@link _ArtifactPublicationConflictError} so nothing above this file has to know which
 * database is underneath.
 *
 * Called by: `_CreateArtifactUploadAuthority` in prisma-artifact-authority.composition.ts.
 */
export class PrismaArtifactPublicationUnitOfWork implements ArtifactPublicationUnitOfWork
{
	/** The product database client. Held privately so no repository or use case above this class can open its own transaction. */
	private readonly prisma: PrismaClient;

	/** Creates the transaction boundary for artifact publication. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/**
	 * Runs the work in one SERIALIZABLE transaction, up to three attempts.
	 *
	 * @param work - Function given repositories bound to the transaction. Must be safe to re-run.
	 * @returns Whatever the work returned, from the attempt that committed.
	 * @throws {@link _ArtifactPublicationConflictError} when the last attempt collides; nothing
	 *   was written. Any error that does not prove a full rollback is rethrown unchanged, so an
	 *   unrecognised failure is never retried.
	 */
	async run<Result>(work: ArtifactPublicationWork<Result>): Promise<Result>
	{
		for (let attempt = 1; attempt <= _PUBLICATION_ATTEMPT_LIMIT; attempt += 1)
		{
			try
			{
				return await this.prisma.$transaction(async function _Run(transaction): Promise<Result>
				{
					const authority = new PrismaArtifactAuthorityRepository(transaction);
					const repositories: ArtifactPublicationTransaction = { revisions: authority, uploadLeases: authority };
					return work(repositories);
				}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			}
			catch (error)
			{
				if (_IsRetryablePublicationConflict(error) && attempt < _PUBLICATION_ATTEMPT_LIMIT) continue;
				if (_IsRetryablePublicationConflict(error)) throw new _ArtifactPublicationConflictError();
				throw error;
			}
		}
		throw new Error("artifact publication exhausted without a result");
	}
}

/** Returns whether Prisma confirms that the whole attempted publication transaction rolled back. */
function _IsRetryablePublicationConflict(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && _RETRYABLE_PUBLICATION_CODES.has(error.code);
}
