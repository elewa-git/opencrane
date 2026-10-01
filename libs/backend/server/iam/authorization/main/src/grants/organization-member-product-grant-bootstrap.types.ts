/** Verified membership coordinates used to reconcile ordinary member creation roots. */
export interface ReconcileOrganizationMemberProductGrantsCommand
{
	readonly siloId: string;
	readonly subject: string;
	readonly principalId: string;
	readonly now: Date;
}

/** Projects active membership into the narrow collection grants needed before resource ids exist. */
export interface OrganizationMemberProductGrantBootstrapRepository
{
	reconcileOrganizationMemberProductGrants(command: ReconcileOrganizationMemberProductGrantsCommand): Promise<number>;
}
