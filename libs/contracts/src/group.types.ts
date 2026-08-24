/**
 * Identifies who may change a group's direct membership.
 *
 * The value crosses the API and database boundary. It does not grant access by itself; grants
 * refer to the group separately.
 */
export enum GroupMembershipAuthorities
{
	/** Login claims are authoritative, so operator writes may not change direct members. */
	External = "external",
	/** OpenCrane operators are authoritative through the group management API. */
	Local = "local",
}

/** Shared group contract returned by the group management API. */
export interface Group
{
	/** Stable identifier used by OIDC claims and authorization grants. */
	id: string;
	/** Silo that owns the group. */
	siloId: string;
	/** Human-readable group name shown to operators. */
	name: string;
	/** Identifies the parent used for arrangement; ancestry does not add members or grants. */
	parentId: string | null;
	/** Authority allowed to reconcile the group's direct membership. */
	membershipAuthority: GroupMembershipAuthorities;
	/** Optional operator-facing description. */
	description?: string;
	/** Stable principal identifiers directly attached to the group. */
	members: string[];
	/** Number of direct members. */
	memberCount: number;
}
