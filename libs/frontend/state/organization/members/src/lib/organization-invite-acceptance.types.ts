import type { OrganizationMember } from "./organization-member-directory.types";

/**
 * Tells the guarded invitation route what happened while the signed-in user consumed its token.
 *
 * The acceptance store holds this state in memory after the route removes the token-bearing URL from
 * browser history. Identity mismatch, expiry, prior use, and invalid input are terminal and clear the
 * token; `Failure` keeps it only for an explicit retry because the server outcome remains unknown.
 */
export enum OrganizationInviteAcceptanceStates
{
	/** The route is removing the token from the address bar before submission. */
	Idle = "idle",
	/** Organization authority is validating and consuming the token. */
	Accepting = "accepting",
	/** The invitation is accepted and the member projection is authoritative. */
	Success = "success",
	/** The signed-in identity does not match the recipient. */
	IdentityMismatch = "identity_mismatch",
	/** The invitation expired before acceptance. */
	Expired = "expired",
	/** The invitation was already consumed. */
	AlreadyUsed = "already_used",
	/** The token was missing or malformed. */
	Invalid = "invalid",
	/** The result is unknown and may be retried. */
	Failure = "failure"
}

/**
 * Returns the server-authored member after the signed-in identity consumes an invitation.
 * The acceptance store publishes this projection only after membership authority confirms success.
 */
export interface AcceptOrganizationInvitationResult
{
	/** Membership authority created or recovered for this acceptance. */
	readonly member: OrganizationMember;
}
