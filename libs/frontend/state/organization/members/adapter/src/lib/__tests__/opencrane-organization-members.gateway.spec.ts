import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ControlPlaneApiService } from "@opencrane/core";
import { OrganizationMembersGatewayErrorKinds, OrganizationMemberRoles } from "@opencrane/state/organization/members";

import { OpenCraneOrganizationMembersGateway } from "../opencrane-organization-members.gateway";

beforeAll(function _InitializeAngularTesting(): void
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
});

afterEach(function _ResetAngularTesting(): void
{
	TestBed.resetTestingModule();
});

/** Configure the adapter with a generated-client-shaped POST mock. */
function _Gateway(post: ReturnType<typeof vi.fn>): OpenCraneOrganizationMembersGateway
{
	TestBed.configureTestingModule({ providers: [OpenCraneOrganizationMembersGateway, { provide: ControlPlaneApiService, useValue: { client: { GET: vi.fn(), POST: post } } }] });
	return TestBed.inject(OpenCraneOrganizationMembersGateway);
}

describe("OpenCrane organization-members gateway", function _OrganizationMembersGatewaySuite()
{
	it("maps stable payment, invitation, and unknown errors without reading their prose", async function _ErrorCodeMapping()
	{
		const payment = _Gateway(vi.fn().mockResolvedValue({ error: { code: "payment_required", error: "host prose" }, response: { status: 402 } }));
		await expect(payment.accept("opaque-token")).rejects.toMatchObject({ kind: OrganizationMembersGatewayErrorKinds.PaymentRequired });
		TestBed.resetTestingModule();

		const alreadyUsed = _Gateway(vi.fn().mockResolvedValue({ error: { code: "already_used", error: "server prose" }, response: { status: 409 } }));
		await expect(alreadyUsed.accept("opaque-token")).rejects.toMatchObject({ kind: OrganizationMembersGatewayErrorKinds.AlreadyUsed });
		TestBed.resetTestingModule();

		const invalid = _Gateway(vi.fn().mockResolvedValue({ error: { code: "invalid", error: "request body is invalid" }, response: { status: 400 } }));
		await expect(invalid.accept("bad-token")).rejects.toMatchObject({ kind: OrganizationMembersGatewayErrorKinds.Invalid });
		TestBed.resetTestingModule();

		const unknown = _Gateway(vi.fn().mockResolvedValue({ error: { code: "future_code", error: "future prose" }, response: { status: 418 } }));
		await expect(unknown.accept("opaque-token")).rejects.toMatchObject({ kind: OrganizationMembersGatewayErrorKinds.Unknown });
	});

	it("places idempotency identity in headers and the invitation identity in body or path", async function _IdempotencyPlacement()
	{
		const invitation = { invitationId: "invite-1", email: "new@example.com", role: "member" as const, status: "pending" as const, expiresAt: "2026-09-01T00:00:00.000Z", invitedAt: "2026-08-17T00:00:00.000Z", invitedByDisplayName: "Jente" };
		const post = vi.fn()
			.mockResolvedValueOnce({ data: { invitations: [invitation], createdCount: 1, inviteLinks: ["https://example.com/invite"] }, response: { status: 201 } })
			.mockResolvedValueOnce({ data: { invitation, inviteLink: "https://example.com/invite/refreshed" }, response: { status: 200 } });
		const gateway = _Gateway(post);

		await gateway.invite({ emails: ["new@example.com"], role: OrganizationMemberRoles.Member, idempotencyKey: "create-key" });
		await gateway.resend("invite-1", "refresh-key");

		expect(post).toHaveBeenNthCalledWith(1, "/organization/members/invitations", { params: { header: { "Idempotency-Key": "create-key" } }, body: { emails: ["new@example.com"], role: OrganizationMemberRoles.Member } });
		expect(post).toHaveBeenNthCalledWith(2, "/organization/members/invitations/{invitationId}/resend", { params: { header: { "Idempotency-Key": "refresh-key" }, path: { invitationId: "invite-1" } } });
	});
});
