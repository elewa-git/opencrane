import { describe, expect, it } from "vitest";

import { OrganizationInvitationStatuses, OrganizationInviteCommandStates, OrganizationMemberDirectoryStates, OrganizationMemberRoles, OrganizationMemberStatuses, type OrganizationMemberDirectory } from "@opencrane/state/organization/members";

import { _MapMembersView } from "../members.mapper";

/** Build a directory containing accepted history, current pending rows, and a failed invitation. */
function _Directory(): OrganizationMemberDirectory
{
	return {
		activeCount: 1,
		pendingCount: 1,
		members: [{ membershipId: "member-1", displayName: "Alex Kim", email: "alex@example.com", role: OrganizationMemberRoles.Member, status: OrganizationMemberStatuses.Active, joinedAt: "2026-08-01T00:00:00.000Z", isCurrentUser: false }],
		invitations: [
			{ invitationId: "invite-pending", email: "pending@example.com", role: OrganizationMemberRoles.Member, status: OrganizationInvitationStatuses.Pending, expiresAt: "2026-08-30T00:00:00.000Z", invitedAt: "2026-08-17T00:00:00.000Z", invitedByDisplayName: "Jente" },
			{ invitationId: "invite-accepted", email: "accepted@example.com", role: OrganizationMemberRoles.Member, status: OrganizationInvitationStatuses.Accepted, expiresAt: "2026-08-20T00:00:00.000Z", invitedAt: "2026-08-10T00:00:00.000Z", invitedByDisplayName: "Jente" },
			{ invitationId: "invite-failed", email: "failed@example.com", role: OrganizationMemberRoles.Admin, status: OrganizationInvitationStatuses.Failed, expiresAt: "2026-08-20T00:00:00.000Z", invitedAt: "2026-08-10T00:00:00.000Z", invitedByDisplayName: "Jente" }
		]
	};
}

describe("members presentation mapping", function _MembersMapperSuite()
{
	it("excludes accepted invitation history and keeps the pending count authoritative", function _PendingProjection()
	{
		const view = _MapMembersView({ directory: _Directory(), directoryState: OrganizationMemberDirectoryStates.Ready, searchQuery: "", refreshError: null, inviteState: OrganizationInviteCommandStates.Editing, inviteIssues: [], inviteError: null, inviteLinks: [], resendingInvitationIds: new Set(), returnedInvitations: [], resentInviteLink: null, resendError: null });
		expect(view.pendingRows.map(row => row.id)).toEqual(["invite-pending", "invite-failed"]);
		expect(view.pendingCount).toBe(1);
		expect(view.pendingRows.find(row => row.id === "invite-failed")?.roleLabel).toBe("Failed");
	});

	it("counts a newly created pending row once while overlaying the returned projection", function _CreatedOverlay()
	{
		const created = { invitationId: "invite-new", email: "new@example.com", role: OrganizationMemberRoles.Member, status: OrganizationInvitationStatuses.Pending, expiresAt: "2026-09-01T00:00:00.000Z", invitedAt: "2026-08-17T00:00:00.000Z", invitedByDisplayName: "Jente" } as const;
		const view = _MapMembersView({ directory: _Directory(), directoryState: OrganizationMemberDirectoryStates.Ready, searchQuery: "new@", refreshError: null, inviteState: OrganizationInviteCommandStates.Success, inviteIssues: [], inviteError: null, inviteLinks: ["https://example.com/invite"], resendingInvitationIds: new Set(), returnedInvitations: [created, created], resentInviteLink: null, resendError: null });
		expect(view.pendingRows.map(row => row.id)).toEqual(["invite-new"]);
		expect(view.pendingCount).toBe(2);
	});

	it("lets a refreshed directory replace an older mutation overlay", function _AuthoritativeRefresh()
	{
		const stale = { invitationId: "invite-accepted", email: "accepted@example.com", role: OrganizationMemberRoles.Member, status: OrganizationInvitationStatuses.Pending, expiresAt: "2026-08-20T00:00:00.000Z", invitedAt: "2026-08-10T00:00:00.000Z", invitedByDisplayName: "Jente" } as const;
		const view = _MapMembersView({ directory: _Directory(), directoryState: OrganizationMemberDirectoryStates.Ready, searchQuery: "accepted@", refreshError: null, inviteState: OrganizationInviteCommandStates.Success, inviteIssues: [], inviteError: null, inviteLinks: [], resendingInvitationIds: new Set(), returnedInvitations: [stale], resentInviteLink: null, resendError: null });
		expect(view.pendingRows).toEqual([]);
		expect(view.pendingCount).toBe(1);
	});

	it("keeps a rotated mutation row over an older directory retained after refresh failure", function _RetainedRefreshPrecedence()
	{
		const rotated = { invitationId: "invite-failed", email: "failed@example.com", role: OrganizationMemberRoles.Admin, status: OrganizationInvitationStatuses.Pending, expiresAt: "2026-09-08T00:00:00.000Z", invitedAt: "2026-09-01T00:00:00.000Z", invitedByDisplayName: "Jente" } as const;
		const view = _MapMembersView({ directory: _Directory(), directoryState: OrganizationMemberDirectoryStates.RetainedRefreshError, searchQuery: "failed@", refreshError: "Members could not be refreshed.", inviteState: OrganizationInviteCommandStates.Editing, inviteIssues: [], inviteError: null, inviteLinks: [], resendingInvitationIds: new Set(), returnedInvitations: [rotated], resentInviteLink: "https://example.com/invitations/rotated", resendError: null });
		expect(view.pendingRows).toHaveLength(1);
		expect(view.pendingRows[0]?.roleLabel).toBe("Pending");
		expect(view.resentInviteLink).toBe("https://example.com/invitations/rotated");
	});
});
