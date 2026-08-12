import type { AuthorizationGrantRepository } from "./effective-access.types.js";
import type { ShareAuthorizationRepository } from "./share-authorization-repository.types.js";

/** Transaction-scoped authorization repositories used by one share procedure. */
export interface ShareAuthorizationTransaction
{
	/** Candidate-grant reader used for the least-privilege decision. */
	readonly grantRepository: AuthorizationGrantRepository;
	/** Catalog and share-grant authority used by the sharing procedure. */
	readonly shareRepository: ShareAuthorizationRepository;
}

/**
 * Runs a share procedure with all its repositories on one transaction.
 *
 * Kept as a port so the sharing routes depend on this shape rather than on Prisma.
 * Implemented by: ./prisma-share-authorization-unit-of-work.ts.
 */
export interface ShareAuthorizationUnitOfWork
{
	/** Executes one share procedure against repositories bound to the same transaction client. */
	execute<Result>(procedure: (transaction: ShareAuthorizationTransaction) => Promise<Result>): Promise<Result>;
}
