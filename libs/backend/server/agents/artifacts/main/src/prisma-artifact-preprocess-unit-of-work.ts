import { Prisma, type PrismaClient } from "@prisma/client";

import { PrismaArtifactPreprocessRepository } from "./prisma-artifact-preprocessing";
import type { ArtifactPreprocessUnitOfWork, ArtifactPreprocessWork } from "./artifact-unit-of-work.types";

/** Total attempts allowed, not retries on top of the first try: the loop runs attempts 1 to 3, so a collision is retried at most twice. */
const _PREPROCESS_ATTEMPT_LIMIT = 3;

/** Prisma codes that confirm no partial preprocessing transition committed. */
const _RETRYABLE_PREPROCESS_CODES = new Set(["P2002", "P2034"]);

/**
 * Opens one SERIALIZABLE transaction per preprocessing operation and retries safe collisions.
 *
 * Up to three complete attempts. A fresh `PrismaArtifactPreprocessRepository` is built for each
 * one, because a repository from a rolled-back attempt holds a dead transaction client. Only the
 * two codes in `_RETRYABLE_PREPROCESS_CODES` are retried; anything else is rethrown immediately.
 *
 * Unlike `PrismaArtifactPublicationUnitOfWork`, this one does not convert an exhausted collision
 * into a domain error - the Prisma error reaches the caller, and the preprocessing router turns
 * it into HTTP 503.
 *
 * Called by: `_CreateArtifactPreprocessAuthority` in prisma-artifact-authority.composition.ts.
 */
export class PrismaArtifactPreprocessUnitOfWork implements ArtifactPreprocessUnitOfWork
{
	/** The product database client. Held privately so router and broker code cannot reach it and open its own transaction. */
	private readonly prisma: PrismaClient;

	/** Creates the preprocessing transaction boundary. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/**
	 * Runs the work in one SERIALIZABLE transaction, up to three attempts.
	 *
	 * @param work - Function given a repository bound to the transaction. Must be safe to re-run,
	 *   because a retry starts it from the beginning.
	 * @returns Whatever the work returned, from the attempt that committed.
	 * @throws The original Prisma error when the last attempt collides, or immediately for any
	 *   error that does not prove a full rollback. Also throws
	 *   "artifact preprocessing exhausted without a result" if the loop ever falls through, which
	 *   should be unreachable and means the retry logic was changed incorrectly.
	 */
	async run<Result>(work: ArtifactPreprocessWork<Result>): Promise<Result>
	{
		for (let attempt = 1; attempt <= _PREPROCESS_ATTEMPT_LIMIT; attempt += 1)
		{
			try
			{
				return await this.prisma.$transaction(async function _Run(transaction): Promise<Result>
				{
					return work(new PrismaArtifactPreprocessRepository(transaction));
				}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			}
			catch (error)
			{
				if (_IsRetryablePreprocessConflict(error) && attempt < _PREPROCESS_ATTEMPT_LIMIT) continue;
				throw error;
			}
		}
		throw new Error("artifact preprocessing exhausted without a result");
	}
}

/** Returns whether Prisma confirms the entire failed preprocessing operation rolled back. */
function _IsRetryablePreprocessConflict(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && _RETRYABLE_PREPROCESS_CODES.has(error.code);
}
