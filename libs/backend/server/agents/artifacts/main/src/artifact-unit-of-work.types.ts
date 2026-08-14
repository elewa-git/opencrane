import type { ArtifactAuthorityRepository } from "./artifact-finalization.types";
import type { ArtifactPreprocessRepository } from "./artifact-preprocessing.types";
import type { ArtifactUploadLeaseRepository } from "./artifact-upload.types";

/**
 * Thrown when two publications collided and retrying inside the transaction did not help.
 *
 * The retry contract: `PrismaArtifactPublicationUnitOfWork` runs the work at PostgreSQL
 * SERIALIZABLE isolation and makes up to three complete attempts. It retries only on the two
 * Prisma error codes that prove the whole attempt rolled back with nothing written, and it
 * rebuilds the repositories for each attempt so no stale transaction client is reused. If the
 * third attempt still collides, it throws this.
 *
 * The error deliberately carries no Prisma code or database detail, so the application layer
 * cannot start branching on the storage engine. `_ArtifactUploadAuthority` catches it and turns
 * it into a plain `conflict` status. That means a caller normally sees `conflict`, never this
 * exception - it escaping to a caller means someone is running the unit of work directly.
 *
 * Nothing was written when this is thrown, so retrying the same command later is safe.
 */
export class _ArtifactPublicationConflictError extends Error
{
	/** Builds the conflict with a fixed message and no database detail attached. */
	constructor()
	{
		super("artifact publication conflict");
	}
}

/**
 * The repositories available inside one publication transaction.
 *
 * Both fields are the same object in practice; they are named separately so a piece of work
 * states which capability it uses. Neither can open or commit a transaction.
 */
export interface ArtifactPublicationTransaction
{
	/** Metadata finalization repository that consumes one promotion receipt. */
	readonly revisions: ArtifactAuthorityRepository;
	/** Write-lease repository that reserves one proof-bound upload. */
	readonly uploadLeases: ArtifactUploadLeaseRepository;
}

/** A function to run inside one publication transaction. It either commits completely or writes nothing, so it must be safe to run again from the start. */
export type ArtifactPublicationWork<Result> = (transaction: ArtifactPublicationTransaction) => Promise<Result>;

/**
 * Opens and commits the database transaction for one publication step.
 *
 * Only implementations of this interface create transactions. Keeping that here is what lets
 * every repository in this package assume it is already inside one.
 *
 * Called by: `_ArtifactUploadAuthority` in artifact-authority.ts, for both the lease reservation
 * and the revision commit. Implemented by `PrismaArtifactPublicationUnitOfWork`.
 */
export interface ArtifactPublicationUnitOfWork
{
	/**
	 * Runs the work in one transaction, retrying only when the database rolled everything back.
	 *
	 * @param work - Function given transaction-scoped repositories. Must be safe to re-run.
	 * @returns Whatever the work returned, from the attempt that committed.
	 * @throws {@link _ArtifactPublicationConflictError} when every attempt collided; nothing was
	 *   written. Any other error is passed through untouched, so an unrecognised failure is never
	 *   silently retried.
	 */
	run<Result>(work: ArtifactPublicationWork<Result>): Promise<Result>;
}

/**
 * Opens and commits the database transaction for one preprocessing step.
 *
 * One transaction per step, never one spanning a worker's whole job. That is what makes the
 * fence necessary and sufficient: each step re-checks the attempt and fence rather than relying
 * on a lock held across HTTP calls.
 *
 * Called by: `_ArtifactPreprocessAuthority` in artifact-preprocess-authority.ts, once per
 * method. Implemented by `PrismaArtifactPreprocessUnitOfWork`.
 */
export interface ArtifactPreprocessUnitOfWork
{
	/**
	 * Runs one preprocessing operation in its own transaction.
	 *
	 * @param work - Function given a repository bound to that transaction. Must be safe to re-run.
	 * @returns Whatever the work returned, from the attempt that committed.
	 * @throws The original database error when retries are exhausted. Unlike the publication unit
	 *   of work, this one does not convert it - callers see the Prisma error, and the router turns
	 *   it into HTTP 503.
	 */
	run<Result>(work: ArtifactPreprocessWork<Result>): Promise<Result>;
}

/** Work executed under exactly one private preprocessing transaction. */
export type ArtifactPreprocessWork<Result> = (repository: ArtifactPreprocessRepository) => Promise<Result>;
