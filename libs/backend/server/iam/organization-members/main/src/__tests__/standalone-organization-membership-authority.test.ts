import { describe, expect, it, vi } from "vitest";

import { OrganizationMemberRoles, OrganizationMemberStatuses } from "../directory.types";
import { HmacOrganizationInvitationTokenAuthority } from "../invitation-token";
import { OrganizationInvitationStatuses } from "../invitations.types";
import { OrganizationMembershipErrorKinds } from "../organization-members.errors";
import type { OrganizationMemberRepository } from "../organization-member-repository.types";
import { StandaloneOrganizationMembershipAuthority } from "../standalone-organization-membership-authority";

/** Verified administrator fixture. */
const _CALLER = { siloId: "acme", subjectId: "admin-1", verifiedEmail: "admin@acme.test", displayName: "Admin" };

/** Pending invitation fixture returned by persistence. */
function _Invitation(expiresAt = new Date(Date.now() + 60_000))
{
	return { invitationId: "invite-1", siloId: "acme", email: "new@acme.test", role: OrganizationMemberRoles.Member as const, status: OrganizationInvitationStatuses.Pending as const, generation: 1, nonce: "abcdefghijklmnop", expiresAt, invitedAt: new Date("2026-08-17T00:00:00.000Z"), invitedByDisplayName: "Admin" };
}

/** Builds a complete repository double with overridable methods. */
function _Repository(overrides: Partial<OrganizationMemberRepository> = {}): OrganizationMemberRepository
{
	return {
		directory: vi.fn().mockResolvedValue({ members: [], invitations: [], activeCount: 0, pendingCount: 0 }),
		validate: vi.fn().mockResolvedValue([]),
		create: vi.fn().mockResolvedValue({ invitations: [_Invitation()], createdCount: 1 }),
		resend: vi.fn().mockResolvedValue(_Invitation()),
		accept: vi.fn().mockResolvedValue({ membershipId: "member-1", displayName: "New", email: "new@acme.test", role: OrganizationMemberRoles.Member, status: OrganizationMemberStatuses.Active, joinedAt: "2026-08-17T00:00:00.000Z", isCurrentUser: true }),
		...overrides,
	};
}

/** Builds standalone authority with a stable test origin. */
function _Authority(repository: OrganizationMemberRepository): StandaloneOrganizationMembershipAuthority
{
	return new StandaloneOrganizationMembershipAuthority(repository, new HmacOrganizationInvitationTokenAuthority(Buffer.alloc(32, 9)), { invitationSigningKey: Buffer.alloc(32, 9), invitationTtlMilliseconds: 60_000, publicBaseUrl: "https://acme.example" });
}

describe("StandaloneOrganizationMembershipAuthority", function _Suite()
{
	it("authors absolute shareable links without storing bearer tokens", async function _Create()
	{
		const result = await _Authority(_Repository()).create({ caller: _CALLER, emails: [" New@Acme.Test "], role: OrganizationMemberRoles.Member, idempotencyKey: "0123456789abcdef" });
		expect(result.createdCount).toBe(1);
		expect(result.inviteLinks[0]).toMatch(/^https:\/\/acme\.example\/invite\?token=/u);
		expect(result.invitations[0]?.inviteLink).toBe(result.inviteLinks[0]);
	});

	it("rejects an invalid recipient on direct create without trusting earlier validation", async function _DirectCreateValidation()
	{
		const repository = _Repository();
		await expect(_Authority(repository).create({ caller: _CALLER, emails: ["not-an-email"], role: OrganizationMemberRoles.Member, idempotencyKey: "0123456789abcdef" })).rejects.toMatchObject({ kind: OrganizationMembershipErrorKinds.Invalid });
		expect(repository.create).not.toHaveBeenCalled();
	});

	it("projects an elapsed pending generation as expired", async function _Expiry()
	{
		const repository = _Repository({ directory: vi.fn().mockResolvedValue({ members: [], invitations: [_Invitation(new Date(0))], activeCount: 0, pendingCount: 0 }) });
		const result = await _Authority(repository).directory(_CALLER);
		expect(result.invitations[0]?.status).toBe(OrganizationInvitationStatuses.Expired);
	});

	it("requires an explicitly verified OIDC email before token acceptance", async function _VerifiedEmail()
	{
		const authority = _Authority(_Repository());
		await expect(authority.accept({ caller: { ..._CALLER, verifiedEmail: null }, token: "x".repeat(64) })).rejects.toMatchObject({ kind: OrganizationMembershipErrorKinds.IdentityMismatch });
	});
});
