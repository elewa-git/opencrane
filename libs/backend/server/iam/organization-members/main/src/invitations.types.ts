import type { OrganizationMember, OrganizationMemberRoles } from "./directory.types";
import type { OrganizationMembershipCaller } from "./authority.types";

/**
 * Describes the invitation lifecycle returned to settings clients.
 *
 * `Pending`, `Accepted`, and `Failed` map to persisted states; `Expired` is projected when the server
 * clock passes `expiresAt`, so expiry needs no database write. These strings cross the public API,
 * and adding or renaming one requires the OpenAPI validators and client mappings to change together.
 */
export enum OrganizationInvitationStatuses
{
	/** The current token generation remains usable until its expiry. */
	Pending = "pending",
	/** A verified matching identity consumed the invitation. */
	Accepted = "accepted",
	/** The current generation passed its server-controlled expiry. */
	Expired = "expired",
	/** The authority could not issue a usable generation. */
	Failed = "failed",
}

/**
 * Explains why organisation authority refused one proposed recipient before creation.
 *
 * The reason is returned over the public API for browser copy and is not persisted as invitation
 * state. The Fleet response validator admits this closed set, so a new policy reason requires both
 * server and client mappings before callers can branch on it.
 */
export enum OrganizationInviteRecipientReasons
{
	/** The submitted value is not a complete email address. */
	InvalidEmail = "invalid_email",
	/** A local or Fleet membership already uses this normalized email. */
	AlreadyMember = "already_member",
	/** A pending invitation already targets this normalized email. */
	AlreadyInvited = "already_invited",
	/** Deployment or Fleet policy does not allow this domain. */
	ExternalDomain = "external_domain",
}

/** One server-issued invitation visible to active organisation administrators. */
export interface OrganizationInvitation
{
	/** Opaque coordinate used for resend. */
	readonly invitationId: string;
	/** Normalized target email. */
	readonly email: string;
	/** Assignable role granted after acceptance. */
	readonly role: OrganizationMemberRoles.Admin | OrganizationMemberRoles.Member;
	/** Current projected lifecycle. */
	readonly status: OrganizationInvitationStatuses;
	/** ISO time after which this generation is rejected. */
	readonly expiresAt: string;
	/** ISO time at which this generation was issued. */
	readonly invitedAt: string;
	/** Peer-visible name of the administrator who issued it. */
	readonly invitedByDisplayName: string;
	/** Server-authored acceptance link when the caller just created or resent it. */
	readonly inviteLink?: string;
}

/** Server validation for one submitted recipient value. */
export interface OrganizationInviteRecipientValidation
{
	/** Value exactly as submitted. */
	readonly email: string;
	/** Lower-cased and trimmed value used by authority. */
	readonly normalizedEmail: string;
	/** Whether the current organisation may invite this value. */
	readonly valid: boolean;
	/** Stable refusal reason when valid is false. */
	readonly reason?: OrganizationInviteRecipientReasons;
}

/** Result of validating all submitted recipients together. */
export interface OrganizationInviteValidationResult
{
	/** One result for every supplied value, in input order. */
	readonly recipients: readonly OrganizationInviteRecipientValidation[];
}

/** Command for validating recipient values under current organisation policy. */
export interface ValidateOrganizationInvitationsCommand
{
	/** Verified caller. */
	readonly caller: OrganizationMembershipCaller;
	/** Untrusted values to validate. */
	readonly emails: readonly string[];
}

/** Command for creating one idempotent invitation batch. */
export interface CreateOrganizationInvitationsCommand
{
	/** Verified caller. */
	readonly caller: OrganizationMembershipCaller;
	/** Recipient values normalized again by authority. */
	readonly emails: readonly string[];
	/** Assignable role. */
	readonly role: OrganizationMemberRoles.Admin | OrganizationMemberRoles.Member;
	/** Opaque retry coordinate scoped to caller and silo. */
	readonly idempotencyKey: string;
}

/** Result of creating or recovering an idempotent invitation batch. */
export interface CreateOrganizationInvitationsResult
{
	/** Invitations created or recovered. */
	readonly invitations: readonly OrganizationInvitation[];
	/** Number of rows newly created by this invocation. */
	readonly createdCount: number;
	/** Server-authored shareable links. */
	readonly inviteLinks: readonly string[];
}

/** Command for rotating one pending invitation generation. */
export interface ResendOrganizationInvitationCommand
{
	/** Verified active administrator. */
	readonly caller: OrganizationMembershipCaller;
	/** Opaque invitation coordinate from the directory. */
	readonly invitationId: string;
	/** Retry coordinate that prevents duplicate rotations. */
	readonly idempotencyKey: string;
}

/** Result of resending one invitation. */
export interface ResendOrganizationInvitationResult
{
	/** Refreshed directory row. */
	readonly invitation: OrganizationInvitation;
	/** Shareable link for the refreshed generation. */
	readonly inviteLink: string;
}

/** Command for accepting an invitation after OIDC. */
export interface AcceptOrganizationInvitationCommand
{
	/** Verified caller, including explicitly verified email. */
	readonly caller: OrganizationMembershipCaller;
	/** Opaque bearer token taken from the server-authored link. */
	readonly token: string;
}

/** Result of consuming one invitation. */
export interface AcceptOrganizationInvitationResult
{
	/** Membership created or recovered for this same subject. */
	readonly member: OrganizationMember;
}
