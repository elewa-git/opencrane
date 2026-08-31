/**
 * Describes the role returned for each organisation membership.
 *
 * These string values cross the public API and map explicitly to the persisted Prisma role. The HTTP
 * layer never treats a browser-held value as authority, and invitation commands exclude `Owner`.
 * Adding or renaming a value requires corresponding persistence, validation, and client mappings.
 */
export enum OrganizationMemberRoles
{
	/** The protected root administrator; invitation commands cannot assign this role. */
	Owner = "owner",
	/** An active member who may administer the organisation. */
	Admin = "admin",
	/** An active participant without member-administration authority. */
	Member = "member",
}

/**
 * Describes whether a persisted organisation membership currently grants participation.
 *
 * Directory clients receive these string values and may branch on them for presentation, but the
 * server rechecks the persisted state for authority. Adding a state requires persistence and client
 * mappings because the API schema admits this closed set.
 */
export enum OrganizationMemberStatuses
{
	/** The subject may participate according to its current grants. */
	Active = "active",
	/** The subject remains recorded but may not participate. */
	Suspended = "suspended",
}

/** One member row returned for the host-selected organisation. */
export interface OrganizationMember
{
	/** Opaque row identity. */
	readonly membershipId: string;
	/** Server-selected peer-visible name. */
	readonly displayName: string;
	/** Normalized email associated with the membership. */
	readonly email: string;
	/** Current role; it does not itself prove authority to the browser. */
	readonly role: OrganizationMemberRoles;
	/** Current durable participation state. */
	readonly status: OrganizationMemberStatuses;
	/** ISO timestamp at which the membership was created. */
	readonly joinedAt: string;
	/** Whether this row represents the verified caller. */
	readonly isCurrentUser: boolean;
}

/** Authoritative member and invitation directory for one host-selected organisation. */
export interface OrganizationMemberDirectory
{
	/** Every membership visible to the authorized caller. */
	readonly members: readonly OrganizationMember[];
	/** Every current or recent invitation visible to the authorized caller. */
	readonly invitations: readonly import("./invitations.types").OrganizationInvitation[];
	/** Number of active memberships. */
	readonly activeCount: number;
	/** Number of pending, unexpired invitations. */
	readonly pendingCount: number;
}
