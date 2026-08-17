/**
 * Describes the role returned for each organisation member row.
 *
 * The generated-client adapter maps the public API's closed literals into this in-memory enum. Views
 * may branch on it for labels, but the browser never derives authority from a role; adding an API
 * value requires an explicit adapter and presentation mapping.
 */
export enum OrganizationMemberRoles
{
	/** Owns the organization and cannot be assigned through an invitation. */
	Owner = "owner",
	/** May administer members and settings when the server grants that capability. */
	Admin = "admin",
	/** Participates without member-administration authority. */
	Member = "member"
}

/**
 * Describes whether organisation authority currently considers a membership active or suspended.
 *
 * The adapter maps the public API value into this in-memory enum, and directory presentation branches
 * on it without granting access. A new API state requires an explicit adapter and view mapping.
 */
export enum OrganizationMemberStatuses
{
	/** The identity may participate according to its current server-side grants. */
	Active = "active",
	/** The identity remains recorded but cannot participate until authority reactivates it. */
	Suspended = "suspended"
}

/**
 * Tells the members route which directory result it can safely render.
 *
 * The directory store derives this in-memory state from its resource, retained data, and browser-safe
 * gateway errors. `RetainedRefreshError` keeps old rows visible with a warning; `Unavailable` means no
 * directory is safe to show, so treating those states alike would either discard useful data or hide staleness.
 */
export enum OrganizationMemberDirectoryStates
{
	/** No directory has resolved and the first read is running. */
	Loading = "loading",
	/** The caller lacks the capability required to see organization members. */
	Forbidden = "forbidden",
	/** The first read failed because organization authority or a dependency is unavailable. */
	Unavailable = "unavailable",
	/** A directory is visible and a refresh is running against it. */
	Refreshing = "refreshing",
	/** Retained rows remain visible after a failed refresh and may be stale. */
	RetainedRefreshError = "retained_refresh_error",
	/** The authoritative directory contains no member or invitation rows. */
	Empty = "empty",
	/** The authoritative directory is available. */
	Ready = "ready"
}

/** One member row returned for the signed-in organization. */
export interface OrganizationMember
{
	/** Opaque membership identifier used for stable row identity. */
	readonly membershipId: string;
	/** Server-selected display name safe to show to organization peers. */
	readonly displayName: string;
	/** Normalized email associated with this membership. */
	readonly email: string;
	/** Current role; the browser does not infer grants from it. */
	readonly role: OrganizationMemberRoles;
	/** Current durable membership state. */
	readonly status: OrganizationMemberStatuses;
	/** ISO timestamp for when this identity joined. */
	readonly joinedAt: string;
	/** Whether this row represents the signed-in caller. */
	readonly isCurrentUser: boolean;
}

/** Authoritative member and invitation directory projection. */
export interface OrganizationMemberDirectory
{
	/** Members currently recorded for this organization. */
	readonly members: readonly OrganizationMember[];
	/** Invitations visible to this caller. */
	readonly invitations: readonly import("./organization-invitations.types").OrganizationInvitation[];
	/** Server-computed active membership count. */
	readonly activeCount: number;
	/** Server-computed pending invitation count. */
	readonly pendingCount: number;
}
