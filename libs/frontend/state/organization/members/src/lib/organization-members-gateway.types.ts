import type { AcceptOrganizationInvitationResult } from "./organization-invite-acceptance.types";
import type { OrganizationMemberDirectory } from "./organization-member-directory.types";
import type { CreateOrganizationInvitationsCommand, CreateOrganizationInvitationsResult, OrganizationInviteValidationResult, ResendOrganizationInvitationResult } from "./organization-invitations.types";

/**
 * The member screen's transport-neutral port to organization membership authority.
 *
 * Implementations authenticate through the ordinary user session and return server-authored
 * projections. No method accepts a silo, subject, caller email, Fleet mode, or payment state because
 * the browser is not allowed to select those authority inputs.
 */
export interface OrganizationMembersGateway
{
	/** Loads the directory the signed-in caller may see. */
	load(): Promise<OrganizationMemberDirectory>;
	/** Validates recipient policy before an administrator confirms creation. */
	validate(emails: readonly string[]): Promise<OrganizationInviteValidationResult>;
	/** Creates or recovers invitations under the supplied server idempotency coordinate. */
	invite(command: CreateOrganizationInvitationsCommand): Promise<CreateOrganizationInvitationsResult>;
	/** Resends one invitation without allowing duplicate clicks to rotate it twice. */
	resend(invitationId: string, idempotencyKey: string): Promise<ResendOrganizationInvitationResult>;
	/** Consumes one server-signed invitation token as the currently signed-in identity. */
	accept(token: string): Promise<AcceptOrganizationInvitationResult>;
}

/**
 * Categorizes public API failures that member stores may branch on safely.
 *
 * The HTTP adapter derives these in-memory values from allowlisted response codes and statuses and
 * reduces everything else to `Unknown`. They are never sent back as authority inputs; adding a value
 * requires the stores to decide whether it is terminal, retryable, or presentation-only.
 */
export enum OrganizationMembersGatewayErrorKinds
{
	/** The signed-in caller may not read or change membership. */
	Forbidden = "forbidden",
	/** A required dependency is temporarily unavailable. */
	Unavailable = "unavailable",
	/** Another command changed the invitation or reused a key differently. */
	Conflict = "conflict",
	/** Fleet payment authority reports that no paid seat is available for the invitation. */
	PaymentRequired = "payment_required",
	/** The invitation token belongs to a different signed-in identity. */
	IdentityMismatch = "identity_mismatch",
	/** The invitation token passed its server-controlled expiry. */
	Expired = "expired",
	/** The invitation token was already consumed. */
	AlreadyUsed = "already_used",
	/** The response did not match a safe browser category. */
	Unknown = "unknown"
}
