import type { AuthorizationAuthority, ManagedAuthorizationGrantRepository, ShareAuthorizationRepository } from "@opencrane/backend/server/iam/authorization";

import type { ResourceShareRepository } from "./resource-share-repository.types";

/** Repositories bound to one resource-sharing database transaction. */
export interface ResourceShareTransaction
{
	/** Writes and soft-revokes exact recipient grants. */
	readonly authorizationShares: Pick<ShareAuthorizationRepository, "revokeManagedShare">;
	/** Central product authority bound to the resource-sharing transaction. */
	readonly authorization: AuthorizationAuthority;
	/** Central managed-grant writer used to revoke recipient ResourceShare access. */
	readonly managedAuthorizationGrants: ManagedAuthorizationGrantRepository;
	/** Reads and writes explicit resource-share relations. */
	readonly resourceShares: ResourceShareRepository;
}

/** Runs one resource-sharing command against repositories in the same transaction. */
export interface ResourceShareUnitOfWork
{
	/** Executes one callback with transaction-scoped authority ports. */
	execute<Result>(procedure: (transaction: ResourceShareTransaction) => Promise<Result>): Promise<Result>;
}
