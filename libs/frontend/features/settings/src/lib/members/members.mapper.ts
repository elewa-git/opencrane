import { ScopeChipTones } from "@opencrane/elements/ui";
import { OrganizationInvitationStatuses, OrganizationInviteCommandStates, OrganizationMemberDirectoryStates, OrganizationMemberRoles, OrganizationMemberStatuses, type OrganizationInviteIssue, type OrganizationInvitation, type OrganizationMember, type OrganizationMemberDirectory } from "@opencrane/state/organization/members";

import { MemberDirectoryRowKinds, type MemberDirectoryRowView, type MembersViewModel } from "./member-directory.types";

/** Inputs from component-scoped state required to build the members presentation. */
interface _MembersMapperInput
{
	/** Latest authoritative or visibly retained directory. */
	readonly directory: OrganizationMemberDirectory | null;
	/** Route read/refresh condition. */
	readonly directoryState: OrganizationMemberDirectoryStates;
	/** Controlled search query. */
	readonly searchQuery: string;
	/** Browser-safe refresh warning. */
	readonly refreshError: string | null;
	/** Current invitation lifecycle. */
	readonly inviteState: OrganizationInviteCommandStates;
	/** Per-recipient validation issues. */
	readonly inviteIssues: readonly OrganizationInviteIssue[];
	/** Browser-safe create failure. */
	readonly inviteError: string | null;
	/** Server-authored create links. */
	readonly inviteLinks: readonly string[];
	/** Invitation ids with an admitted resend command. */
	readonly resendingInvitationIds: ReadonlySet<string>;
	/** Authoritative invitation rows returned by create and resend mutations. */
	readonly returnedInvitations: readonly OrganizationInvitation[];
	/** Latest server-authored resend link. */
	readonly resentInviteLink: string | null;
	/** Browser-safe resend failure. */
	readonly resendError: string | null;
}

/**
 * Map server models and store conditions into display-only directory rows.
 *
 * Called by: MembersRouteComponent's computed `view` signal.
 *
 * @param input - Current state signals read in one computed evaluation.
 * @returns Presentation model with search applied and no authority decisions added.
 */
export function _MapMembersView(input: _MembersMapperInput): MembersViewModel
{
	const query = input.searchQuery.trim().toLocaleLowerCase();
	const directory = input.directory;
	const invitations = _MergeReturnedInvitations(directory?.invitations ?? [], input.returnedInvitations);
	const visibleInvitations = invitations.filter(invitation => invitation.status !== OrganizationInvitationStatuses.Accepted);
	const knownInvitationIds = new Set((directory?.invitations ?? []).map(invitation => invitation.invitationId));
	const newlyCreatedPending = _CountNewPending(input.returnedInvitations, knownInvitationIds);
	const activeRows = (directory?.members ?? []).map(_MemberRow).filter(row => _Matches(row, query));
	const pendingRows = visibleInvitations.map(invitation => _InvitationRow(invitation, input.resendingInvitationIds)).filter(row => _Matches(row, query));
	return {
		directoryState: input.directoryState,
		activeCount: directory?.activeCount ?? 0,
		pendingCount: (directory?.pendingCount ?? 0) + newlyCreatedPending,
		activeRows,
		pendingRows,
		searchQuery: input.searchQuery,
		refreshError: input.refreshError,
		inviteState: input.inviteState,
		inviteIssues: input.inviteIssues,
		inviteError: input.inviteError,
		inviteLinks: input.inviteLinks,
		resentInviteLink: input.resentInviteLink,
		resendError: input.resendError
	};
}

/** Count mutation-returned pending ids the read projection has not incorporated yet. */
function _CountNewPending(returned: readonly OrganizationInvitation[], knownIds: ReadonlySet<string>): number
{
	const newIds = new Set(returned.filter(invitation => invitation.status === OrganizationInvitationStatuses.Pending && !knownIds.has(invitation.invitationId)).map(invitation => invitation.invitationId));
	return newIds.size;
}

/** Keep the newest authoritative invitation generation while the independent read store catches up. */
function _MergeReturnedInvitations(directory: readonly OrganizationInvitation[], returned: readonly OrganizationInvitation[]): readonly OrganizationInvitation[]
{
	const merged = new Map(returned.map(invitation => [invitation.invitationId, invitation]));
	for (const invitation of directory)
	{
		const returnedInvitation = merged.get(invitation.invitationId);
		if (returnedInvitation === undefined || invitation.invitedAt >= returnedInvitation.invitedAt) merged.set(invitation.invitationId, invitation);
	}
	return [...merged.values()];
}

/** Map one accepted membership into a display row. */
function _MemberRow(member: OrganizationMember): MemberDirectoryRowView
{
	return {
		id: member.membershipId,
		kind: MemberDirectoryRowKinds.Member,
		initials: _Initials(member.displayName || member.email),
		name: member.displayName || member.email,
		email: member.email,
		roleLabel: _RoleLabel(member.role),
		roleTone: member.role === OrganizationMemberRoles.Member ? ScopeChipTones.Neutral : ScopeChipTones.Warning,
		detail: member.status === OrganizationMemberStatuses.Active ? "Active member" : "Membership suspended",
		isCurrentUser: member.isCurrentUser,
		canResend: false,
		resending: false
	};
}

/** Map one invitation into a display row without fabricating delivery or acceptance state. */
function _InvitationRow(invitation: OrganizationInvitation, busyIds: ReadonlySet<string>): MemberDirectoryRowView
{
	return {
		id: invitation.invitationId,
		kind: MemberDirectoryRowKinds.Invitation,
		initials: _Initials(invitation.email),
		name: invitation.email,
		email: invitation.email,
		roleLabel: _InvitationLabel(invitation.status),
		roleTone: _InvitationTone(invitation.status),
		detail: `Invited ${_DateLabel(invitation.invitedAt)} · expires ${_DateLabel(invitation.expiresAt)}`,
		isCurrentUser: false,
		canResend: invitation.status === OrganizationInvitationStatuses.Pending || invitation.status === OrganizationInvitationStatuses.Failed || invitation.status === OrganizationInvitationStatuses.Expired,
		resending: busyIds.has(invitation.invitationId)
	};
}

/** Keep rows whose display name or email includes the normalized query. */
function _Matches(row: MemberDirectoryRowView, query: string): boolean
{
	return query.length === 0 || row.name.toLocaleLowerCase().includes(query) || row.email.toLocaleLowerCase().includes(query);
}

/** Derive at most two initials from display-safe text. */
function _Initials(value: string): string
{
	const parts = value.replace("@", " ").split(/\s+/).filter(part => part.length > 0);
	return parts.slice(0, 2).map(part => part[0]?.toLocaleUpperCase() ?? "").join("") || "?";
}

/** Convert stable roles to concise labels. */
function _RoleLabel(role: OrganizationMemberRoles): string
{
	switch (role)
	{
		case OrganizationMemberRoles.Owner: return "Owner";
		case OrganizationMemberRoles.Admin: return "Admin";
		case OrganizationMemberRoles.Member: return "Member";
	}
}

/** Convert invitation lifecycle to a readable status. */
function _InvitationLabel(status: OrganizationInvitationStatuses): string
{
	switch (status)
	{
		case OrganizationInvitationStatuses.Pending: return "Pending";
		case OrganizationInvitationStatuses.Accepted: return "Accepted";
		case OrganizationInvitationStatuses.Expired: return "Expired";
		case OrganizationInvitationStatuses.Failed: return "Failed";
	}
}

/** Preserve invitation lifecycle meaning through the shared semantic chip vocabulary. */
function _InvitationTone(status: OrganizationInvitationStatuses): ScopeChipTones
{
	switch (status)
	{
		case OrganizationInvitationStatuses.Pending: return ScopeChipTones.Warning;
		case OrganizationInvitationStatuses.Accepted: return ScopeChipTones.Success;
		case OrganizationInvitationStatuses.Expired: return ScopeChipTones.Neutral;
		case OrganizationInvitationStatuses.Failed: return ScopeChipTones.Danger;
	}
}

/** Format one server timestamp without using it for policy or expiry decisions. */
function _DateLabel(value: string): string
{
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return value;
	return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(parsed);
}
