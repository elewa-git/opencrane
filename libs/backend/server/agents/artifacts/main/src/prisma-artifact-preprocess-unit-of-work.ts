import type { PrismaClient } from "@prisma/client";

import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import { PrismaArtifactPreprocessRepository } from "./prisma-artifact-preprocessing";
import type { ArtifactPreprocessUnitOfWork, ArtifactPreprocessWork } from "./artifact-unit-of-work.types";

/**
 * Opens one SERIALIZABLE transaction per preprocessing operation and retries safe collisions.
 *
 * The shared unit-of-work envelope runs up to three complete attempts. A fresh
 * `PrismaArtifactPreprocessRepository` is built for each one, because a repository from a
 * rolled-back attempt holds a dead transaction client. Only the envelope's proven-rollback codes
 * (P2002 and P2034) are retried; anything else is rethrown immediately.
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
	 *   error that does not prove a full rollback.
	 */
	async run<Result>(work: ArtifactPreprocessWork<Result>): Promise<Result>
	{
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Run(transaction): Promise<Result>
		{
			return work(new PrismaArtifactPreprocessRepository(transaction));
		}, { isolationLevel: "Serializable", operation: "artifact preprocessing", attemptLimit: 3 });
	}
}
