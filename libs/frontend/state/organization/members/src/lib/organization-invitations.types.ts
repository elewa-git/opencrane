import type { OrganizationMemberRoles } from "./organization-member-directory.types";

/**
 * Describes the server-owned lifecycle shown for an invitation row.
 *
 * The generated-client adapter maps public API literals into this in-memory enum. Views may offer
 * resend for `Pending`, `Expired`, or `Failed`, but cannot infer delivery or acceptance beyond the
 * returned state; adding an API value requires explicit adapter and presentation mappings.
 */
export enum OrganizationInvitationStatuses
{
	/** The invitation can be accepted before its server-provided expiry. */
	Pending = "pending",
	/** The invitation became a membership. */
	Accepted = "accepted",
	/** The server no longer accepts the invitation because its expiry passed. */
	Expired = "expired",
	/** Invitation creation or refresh failed without evidence of acceptance. */
	Failed = "failed"
}

/**
 * Explains why organisation authority rejected one proposed recipient before creation.
 *
 * Stores translate these API values into browser copy without recreating policy locally. The enum is
 * held only in memory, and a new server reason requires an explicit copy mapping.
 */
export enum OrganizationInviteRecipientReasons
{
	/** The supplied value is not a complete email address. */
	InvalidEmail = "invalid_email",
	/** The normalized email already belongs to a member. */
	AlreadyMember = "already_member",
	/** A pending invitation already targets the normalized email. */
	AlreadyInvited = "already_invited",
	/** Current organization policy does not admit this email domain. */
	ExternalDomain = "external_domain"
}

/**
 * Tells the invitation form what may happen next for its current draft command.
 *
 * The create store holds this state in memory. `Validating` and `Submitting` reject duplicate
 * admission, `Invalid` keeps recipient issues editable, and `Failure` preserves the unresolved retry
 * identity; `Success` and `Partial` expose the server result without predicting missing invitations.
 */
export enum OrganizationInviteCommandStates
{
	/** The form accepts recipients and an assignable role. */
	Editing = "editing",
	/** Recipient validation is running. */
	Validating = "validating",
	/** At least one recipient failed validation. */
	Invalid = "invalid",
	/** Invitation creation is running. */
	Submitting = "submitting",
	/** Authority created every accepted invitation. */
	Success = "success",
	/** Some accepted recipients were created while another result remained unresolved. */
	Partial = "partial",
	/** The command failed without an authoritative create result. */
	Failure = "failure"
}

/** One server-issued invitation visible to authorized administrators. */
export interface OrganizationInvitation
{
	/** Opaque coordinate used for resend commands. */
	readonly invitationId: string;
	/** Normalized target email. */
	readonly email: string;
	/** Role assigned only after valid acceptance. */
	readonly role: Exclude<OrganizationMemberRoles, OrganizationMemberRoles.Owner>;
	/** Current invitation lifecycle state. */
	readonly status: OrganizationInvitationStatuses;
	/** ISO timestamp after which authority rejects acceptance. */
	readonly expiresAt: string;
	/** ISO timestamp for the current invitation generation. */
	readonly invitedAt: string;
	/** Display name of the administrator who sent this invitation. */
	readonly invitedByDisplayName: string;
	/** Server-authored acceptance link returned when policy permits sharing it. */
	readonly inviteLink?: string;
}

/** Server validation for one requested email value. */
export interface OrganizationInviteRecipientValidation
{
	/** Value exactly as submitted by the browser. */
	readonly email: string;
	/** Server-normalized value used for policy decisions. */
	readonly normalizedEmail: string;
	/** Whether this recipient may be submitted. */
	readonly valid: boolean;
	/** Server-owned rejection reason when invalid. */
	readonly reason?: OrganizationInviteRecipientReasons;
}

/** Result of validating all proposed recipients together. */
export interface OrganizationInviteValidationResult
{
	/** One result for every proposed recipient. */
	readonly recipients: readonly OrganizationInviteRecipientValidation[];
}

/** Command used after validation to create invitations. */
export interface CreateOrganizationInvitationsCommand
{
	/** Server-normalized recipient emails. */
	readonly emails: readonly string[];
	/** Assignable role that valid acceptance will grant. */
	readonly role: Exclude<OrganizationMemberRoles, OrganizationMemberRoles.Owner>;
	/** Opaque retry coordinate reused only while this draft remains unresolved. */
	readonly idempotencyKey: string;
}

/** Server result for a create command. */
export interface CreateOrganizationInvitationsResult
{
	/** Invitations created or recovered by this idempotent command. */
	readonly invitations: readonly OrganizationInvitation[];
	/** Number of invitation rows newly created. */
	readonly createdCount: number;
	/** Server-authored acceptance links; the browser never assembles them. */
	readonly inviteLinks: readonly string[];
}

/** Result of resending one pending invitation generation. */
export interface ResendOrganizationInvitationResult
{
	/** Refreshed authoritative invitation row. */
	readonly invitation: OrganizationInvitation;
	/** Server-authored shareable link for the refreshed generation. */
	readonly inviteLink: string;
}

/** Store-level validation message attached to one normalized recipient. */
export interface OrganizationInviteIssue
{
	/** Recipient to which this issue applies. */
	readonly email: string;
	/** Browser-safe explanation translated from the server-owned reason. */
	readonly message: string;
}
