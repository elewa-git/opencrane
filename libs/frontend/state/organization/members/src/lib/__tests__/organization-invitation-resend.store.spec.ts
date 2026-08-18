import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ORGANIZATION_MEMBERS_GATEWAY } from "../organization-members.gateway";
import type { OrganizationMembersGateway } from "../organization-members-gateway.types";
import { OrganizationInvitationResendStore } from "../organization-invitation-resend.store";
import { OrganizationInvitationStatuses } from "../organization-invitations.types";
import { OrganizationMemberRoles } from "../organization-member-directory.types";

beforeAll(function _InitializeAngularTesting(): void
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
});

afterEach(function _ResetAngularTesting(): void { TestBed.resetTestingModule(); });
afterAll(function _ResetAngularEnvironment(): void { TestBed.resetTestEnvironment(); });

/** Build a complete gateway mock while the test controls only resend. */
function _Gateway(): OrganizationMembersGateway
{
	return { load: vi.fn(), validate: vi.fn(), invite: vi.fn(), resend: vi.fn(), accept: vi.fn() };
}

describe("organization invitation resend store", function _InvitationResendStoreSuite()
{
	it("publishes the rotated row and server-authored replacement link", async function _PublishesRotation()
	{
		const gateway = _Gateway();
		const invitation = { invitationId: "invite-1", email: "alex@example.com", role: OrganizationMemberRoles.Member, status: OrganizationInvitationStatuses.Pending, expiresAt: "2026-09-08T00:00:00.000Z", invitedAt: "2026-09-01T00:00:00.000Z", invitedByDisplayName: "Jente" } as const;
		const inviteLink = "https://example.com/invitations/rotated";
		vi.mocked(gateway.resend).mockResolvedValue({ invitation, inviteLink });
		TestBed.configureTestingModule({ providers: [OrganizationInvitationResendStore, { provide: ORGANIZATION_MEMBERS_GATEWAY, useValue: gateway }] });
		const store = TestBed.inject(OrganizationInvitationResendStore);

		expect(await store.resend("invite-1")).toBe(true);

		expect(store.invitations()).toEqual([invitation]);
		expect(store.link()).toBe(inviteLink);
		expect(store.busyIds().size).toBe(0);
		expect(vi.mocked(gateway.resend).mock.calls[0]?.[1].length).toBeGreaterThanOrEqual(16);
	});
});
