import { OrganizationInvitationStatuses, OrganizationInviteRecipientReasons, OrganizationMemberRoles, OrganizationMemberStatuses, type AcceptOrganizationInvitationResult, type CreateOrganizationInvitationsResult, type OrganizationInvitation, type OrganizationInviteValidationResult, type OrganizationMember, type OrganizationMemberDirectory, type ResendOrganizationInvitationResult } from "@opencrane/state/organization/members";

import type { OrganizationInviteAcceptanceWire, OrganizationInviteCreateWire, OrganizationInviteResendWire, OrganizationInviteValidationWire, OrganizationMemberDirectoryWire } from "./organization-members-wire.types";

/** Map one generated directory response into the state port's documented enums. */
export function _MapOrganizationMemberDirectory(value: OrganizationMemberDirectoryWire): OrganizationMemberDirectory
{
	return { members: value.members.map(_MapMember), invitations: value.invitations.map(_MapInvitation), activeCount: value.activeCount, pendingCount: value.pendingCount };
}

/** Map generated recipient decisions without changing server-owned policy. */
export function _MapOrganizationInviteValidation(value: OrganizationInviteValidationWire): OrganizationInviteValidationResult
{
	return { recipients: value.recipients.map(function map(recipient) { return { ...recipient, reason: recipient.reason === undefined ? undefined : _MapReason(recipient.reason) }; }) };
}

/** Map a generated create result and preserve server-authored links. */
export function _MapOrganizationInviteCreate(value: OrganizationInviteCreateWire): CreateOrganizationInvitationsResult
{
	return { invitations: value.invitations.map(_MapInvitation), createdCount: value.createdCount, inviteLinks: value.inviteLinks };
}

/** Map a generated resend result and preserve its server-authored link. */
export function _MapOrganizationInviteResend(value: OrganizationInviteResendWire): ResendOrganizationInvitationResult
{
	return { invitation: _MapInvitation(value.invitation), inviteLink: value.inviteLink };
}

/** Map the membership created by signed-in invitation acceptance. */
export function _MapOrganizationInviteAcceptance(value: OrganizationInviteAcceptanceWire): AcceptOrganizationInvitationResult
{
	return { member: _MapMember(value.member) };
}

/** Map one generated member row into the state enum contract. */
function _MapMember(value: OrganizationMemberDirectoryWire["members"][number]): OrganizationMember
{
	return { ...value, role: _MapRole(value.role), status: _MapMemberStatus(value.status) };
}

/** Map one generated invitation row into the state enum contract. */
function _MapInvitation(value: OrganizationMemberDirectoryWire["invitations"][number]): OrganizationInvitation
{
	const role = value.role === "admin" ? OrganizationMemberRoles.Admin : OrganizationMemberRoles.Member;
	return { ...value, role, status: _MapInvitationStatus(value.status) };
}

/** Exhaustively map generated role literals into documented state enums. */
function _MapRole(value: OrganizationMemberDirectoryWire["members"][number]["role"]): OrganizationMemberRoles
{
	switch (value)
	{
		case "owner": return OrganizationMemberRoles.Owner;
		case "admin": return OrganizationMemberRoles.Admin;
		case "member": return OrganizationMemberRoles.Member;
	}
}

/** Exhaustively map generated member status literals. */
function _MapMemberStatus(value: OrganizationMemberDirectoryWire["members"][number]["status"]): OrganizationMemberStatuses
{
	return value === "active" ? OrganizationMemberStatuses.Active : OrganizationMemberStatuses.Suspended;
}

/** Exhaustively map generated invitation status literals. */
function _MapInvitationStatus(value: OrganizationMemberDirectoryWire["invitations"][number]["status"]): OrganizationInvitationStatuses
{
	switch (value)
	{
		case "pending": return OrganizationInvitationStatuses.Pending;
		case "accepted": return OrganizationInvitationStatuses.Accepted;
		case "expired": return OrganizationInvitationStatuses.Expired;
		case "failed": return OrganizationInvitationStatuses.Failed;
	}
}

/** Exhaustively map generated recipient reason literals. */
function _MapReason(value: NonNullable<OrganizationInviteValidationWire["recipients"][number]["reason"]>): OrganizationInviteRecipientReasons
{
	switch (value)
	{
		case "invalid_email": return OrganizationInviteRecipientReasons.InvalidEmail;
		case "already_member": return OrganizationInviteRecipientReasons.AlreadyMember;
		case "already_invited": return OrganizationInviteRecipientReasons.AlreadyInvited;
		case "external_domain": return OrganizationInviteRecipientReasons.ExternalDomain;
	}
}
