import type { AuthorizationResourceLocator } from "@opencrane/models/authorization";

/** Carries the resource coordinates whose grants must retire with the owning product rows. */
export interface RetireAuthorizationResourceGrantsCommand
{
	/** Silo that owns the resources and grant rows. */
	readonly siloId: string;
	/** Exact resource coordinates that the owning product domain is retiring. */
	readonly resources: readonly AuthorizationResourceLocator[];
	/** Trusted transaction time recorded on every matching live grant. */
	readonly now: Date;
}

/**
 * Revokes grants in the same transaction that retires their product resources.
 *
 * Called by: `__AuthorizationAuthority.retireResourceGrants` after it records the current
 * organisation-administration decision. Implementations must match the silo and full resource
 * coordinate so deleting one resource cannot revoke grants for another.
 */
export interface AuthorizationResourceGrantRetirementRepository
{
	/** @returns The number of active grant rows soft-revoked on the supplied resource coordinates. */
	retireResourceGrants(command: RetireAuthorizationResourceGrantsCommand): Promise<number>;
}
