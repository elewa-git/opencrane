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

/** Unit of work that binds every authorization repository in a share procedure to one transaction. */
export interface ShareAuthorizationUnitOfWork
{
	/** Executes one share procedure against repositories bound to the same transaction client. */
	execute<Result>(procedure: (transaction: ShareAuthorizationTransaction) => Promise<Result>): Promise<Result>;
}
