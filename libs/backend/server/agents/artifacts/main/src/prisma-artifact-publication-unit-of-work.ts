import type { PrismaClient } from "@prisma/client";

import { ___IsRolledBackConflict, ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { PrismaArtifactAuthorityRepository } from "./prisma-artifact-authority";
import { _ArtifactPublicationConflictError, type ArtifactPublicationTransaction, type ArtifactPublicationUnitOfWork, type ArtifactPublicationWork } from "./artifact-unit-of-work.types";

/**
 * Opens one SERIALIZABLE transaction per publication step and retries safe collisions.
 *
 * The shared unit-of-work envelope runs up to three complete attempts, with fresh
 * transaction-scoped repositories each time. Only the envelope's proven-rollback codes (P2002 and
 * P2034) are retried, because they prove the attempt rolled back with nothing written. When the
 * last attempt still collides, the Prisma error is converted into
 * {@link _ArtifactPublicationConflictError} so nothing above this file has to know which
 * database is underneath.
 *
 * Called by: `_CreateArtifactUploadAuthority` in prisma-artifact-authority.composition.ts.
 */
export class PrismaArtifactPublicationUnitOfWork implements ArtifactPublicationUnitOfWork
{
	/** The product database client. Held privately so no repository or use case above this class can open its own transaction. */
	private readonly prisma: PrismaClient;
	/** Saves remote PDF work through each publication attempt's database transaction. */
	private readonly workflow: Pick<IWorkflowEngine, "spawn">;

	/**
	 * Creates the transaction boundary for artifact publication.
	 * @param prisma - Product database client that opens each serializable attempt.
	 * @param workflow - Guarded engine that receives the attempt's Prisma transaction for PDF tasks.
	 */
	constructor(prisma: PrismaClient, workflow: Pick<IWorkflowEngine, "spawn">)
	{
		this.prisma = prisma;
		this.workflow = workflow;
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
		const workflow = this.workflow;
		try
		{
			return await ___RunInPrismaUnitOfWork(this.prisma, async function _Run(transaction): Promise<Result>
			{
				const authority = new PrismaArtifactAuthorityRepository(transaction, workflow);
				const repositories: ArtifactPublicationTransaction = { revisions: authority, uploadLeases: authority };
				return work(repositories);
			}, { isolationLevel: "Serializable", operation: "artifact publication", attemptLimit: 3 });
		}
		catch (error)
		{
			// The envelope rethrows the last proven-rollback conflict unchanged; translate it here so callers never see a Prisma error.
			if (___IsRolledBackConflict(error))
			{
				throw new _ArtifactPublicationConflictError();
			}
			throw error;
		}
	}
}
