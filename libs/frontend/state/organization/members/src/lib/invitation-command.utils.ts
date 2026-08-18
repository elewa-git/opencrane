import { OrganizationInviteRecipientReasons, type CreateOrganizationInvitationsCommand, type OrganizationInvitation, type OrganizationInviteIssue } from "./organization-invitations.types";
import { OrganizationMemberRoles } from "./organization-member-directory.types";

/** Normalize free-entry recipient tokens before local duplicate validation. */
export function _NormalizeInviteEmails(emails: readonly string[]): readonly string[]
{
	return emails.map(email => email.trim().toLowerCase()).filter(email => email.length > 0);
}

/** Find repeated normalized values before authority is called. */
export function _DuplicateInviteIssues(emails: readonly string[]): readonly OrganizationInviteIssue[]
{
	const counts = new Map<string, number>();
	for (const email of emails) counts.set(email, (counts.get(email) ?? 0) + 1);
	return emails.filter(email => (counts.get(email) ?? 0) > 1).filter(function unique(email: string, index: number, values: readonly string[]): boolean { return values.indexOf(email) === index; }).map(function issue(email: string): OrganizationInviteIssue { return { email, message: "Remove the duplicate email address before sending." }; });
}

/** Translate one server-owned recipient rejection into browser copy. */
export function _InviteRecipientIssue(recipient: { readonly email: string; readonly normalizedEmail: string; readonly reason?: OrganizationInviteRecipientReasons }): OrganizationInviteIssue
{
	const messages: Partial<Record<OrganizationInviteRecipientReasons, string>> = {
		[OrganizationInviteRecipientReasons.AlreadyMember]: "This person is already a member.",
		[OrganizationInviteRecipientReasons.AlreadyInvited]: "A pending invitation already exists for this email.",
		[OrganizationInviteRecipientReasons.ExternalDomain]: "Current organization policy does not allow this email domain.",
		[OrganizationInviteRecipientReasons.InvalidEmail]: "Enter a complete email address."
	};
	return { email: recipient.normalizedEmail || recipient.email, message: recipient.reason ? messages[recipient.reason] ?? "This email address cannot be invited." : "This email address cannot be invited." };
}

/** Reuse a pending command only when recipient order and role are unchanged. */
export function _CreateInviteCommand(previous: CreateOrganizationInvitationsCommand | null, emails: readonly string[], role: Exclude<OrganizationMemberRoles, OrganizationMemberRoles.Owner>): CreateOrganizationInvitationsCommand
{
	if (previous !== null && previous.role === role && _SameInviteValues(previous.emails, emails)) return previous;
	return { emails, role, idempotencyKey: _NewInvitationIdempotencyKey() };
}

/** Merge returned invitation rows without predicting fields authority did not send. */
export function _MergeReturnedInvitations(changed: readonly OrganizationInvitation[], current: readonly OrganizationInvitation[]): readonly OrganizationInvitation[]
{
	const ids = new Set(changed.map(invitation => invitation.invitationId));
	return [...changed, ...current.filter(invitation => !ids.has(invitation.invitationId))];
}

/** Create an opaque retry coordinate that meets the API's minimum length. */
export function _NewInvitationIdempotencyKey(): string
{
	if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
	return `invite-${Date.now()}-${Math.random().toString(36).slice(2)}-retry`;
}

/** Compare exact normalized recipient lists so retry identity never crosses an edit. */
function _SameInviteValues(left: readonly string[], right: readonly string[]): boolean
{
	return left.length === right.length && left.every(function same(value: string, index: number): boolean { return value === right[index]; });
}
