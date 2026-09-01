/**
 * Revokes the managed grant referenced by a resource-share recipient row.
 *
 * Called by: `ResourceShareService` while it removes that recipient in the same transaction. The
 * manager and creating Principal must match; a mismatch returns `false` so the caller rolls back
 * the recipient deletion instead of leaving the relation and grant out of sync.
 */
export interface ManagedShareRevocationRepository
{
	/** @returns `true` when the matching active grant was revoked, or `false` when any owner coordinate differed. */
	revokeManagedShare(siloId: string, managerId: string, createdByPrincipalId: string, grantId: string): Promise<boolean>;
}
