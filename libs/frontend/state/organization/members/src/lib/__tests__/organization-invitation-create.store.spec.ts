import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { OrganizationMembersGatewayError } from "../organization-members.errors";
import { ORGANIZATION_MEMBERS_GATEWAY } from "../organization-members.gateway";
import { OrganizationMembersGatewayErrorKinds, type OrganizationMembersGateway } from "../organization-members-gateway.types";
import { OrganizationInvitationCreateStore } from "../organization-invitation-create.store";
import { OrganizationInvitationStatuses, OrganizationInviteCommandStates } from "../organization-invitations.types";
import { OrganizationMemberRoles } from "../organization-member-directory.types";

beforeAll(function _InitializeAngularTesting(): void
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
});

afterEach(function _ResetAngularTesting(): void
{
	TestBed.resetTestingModule();
});

/** Build a complete gateway mock while each test controls only validation and create. */
function _Gateway(): OrganizationMembersGateway
{
	return { load: vi.fn(), validate: vi.fn(), invite: vi.fn(), resend: vi.fn(), accept: vi.fn() };
}

describe("organization invitation create store", function _InvitationCreateStoreSuite()
{
	it("reuses one idempotency key when an unchanged failed draft is retried", async function _RetryIdentity()
	{
		const gateway = _Gateway();
		vi.mocked(gateway.validate).mockResolvedValue({ recipients: [{ email: "A@example.com", normalizedEmail: "a@example.com", valid: true }] });
		vi.mocked(gateway.invite).mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce({ createdCount: 1, inviteLinks: ["https://example.com/invite"], invitations: [{ invitationId: "invite-1", email: "a@example.com", role: OrganizationMemberRoles.Member, status: OrganizationInvitationStatuses.Pending, expiresAt: "2026-09-01T00:00:00.000Z", invitedAt: "2026-08-17T00:00:00.000Z", invitedByDisplayName: "Jente" }] });
		TestBed.configureTestingModule({ providers: [OrganizationInvitationCreateStore, { provide: ORGANIZATION_MEMBERS_GATEWAY, useValue: gateway }] });
		const store = TestBed.inject(OrganizationInvitationCreateStore);
		await store.invite(["A@example.com"], OrganizationMemberRoles.Member);
		await store.invite(["A@example.com"], OrganizationMemberRoles.Member);
		const commands = vi.mocked(gateway.invite).mock.calls.map(call => call[0]);
		expect(commands[0]?.idempotencyKey).toBe(commands[1]?.idempotencyKey);
		expect(store.state()).toBe(OrganizationInviteCommandStates.Success);
	});

	it("shows Fleet payment denial without calculating plan or seat state", async function _PaymentRequired()
	{
		const gateway = _Gateway();
		vi.mocked(gateway.validate).mockResolvedValue({ recipients: [{ email: "a@example.com", normalizedEmail: "a@example.com", valid: true }] });
		vi.mocked(gateway.invite).mockRejectedValue(new OrganizationMembersGatewayError(OrganizationMembersGatewayErrorKinds.PaymentRequired, "payment_required"));
		TestBed.configureTestingModule({ providers: [OrganizationInvitationCreateStore, { provide: ORGANIZATION_MEMBERS_GATEWAY, useValue: gateway }] });
		const store = TestBed.inject(OrganizationInvitationCreateStore);
		await store.invite(["a@example.com"], OrganizationMemberRoles.Admin);
		expect(store.error()).toBe("Your workspace needs an available paid seat before this invitation can be created.");
	});
});
