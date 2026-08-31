/** Inputs derived from verified identity and the Principal resolved in the current transaction. */
export interface ReconcileOrganizationAdminGrantCommand
{
	/** Silo selected from the trusted request host. */
	readonly siloId: string;
	/** OIDC subject verified by authenticated request admission. */
	readonly subject: string;
	/** Local Principal resolved for the verified issuer and subject. */
	readonly principalId: string;
	/** Server time used when a role change revokes the managed grant. */
	readonly now: Date;
}

/**
 * Projects the current organisation role into the central grant table.
 *
 * This repository is a bootstrap adapter: it reads membership only to reconcile the managed grant.
 * Later authorization decisions read `AuthorizationGrant` and never treat a role as permission.
 *
 * Called by: `PrismaAuthenticatedPrincipalAdmissionUnitOfWork` after it resolves the local Principal.
 */
export interface OrganizationAdminGrantBootstrapRepository
{
	/**
	 * Creates the managed administration grant for an active Owner or Admin and revokes it otherwise.
	 * @param command - Verified identity, local Principal, silo, and server time from one transaction.
	 * @returns The number of managed grants created or revoked by this reconciliation.
	 */
	reconcileOrganizationAdminGrant(command: ReconcileOrganizationAdminGrantCommand): Promise<number>;
}
