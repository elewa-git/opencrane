import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { OrganizationMembersGatewayError } from "../organization-members.errors";
import { ORGANIZATION_MEMBERS_GATEWAY } from "../organization-members.gateway";
import { OrganizationMembersGatewayErrorKinds, type OrganizationMembersGateway } from "../organization-members-gateway.types";
import { OrganizationInviteAcceptanceStore } from "../organization-invite-acceptance.store";
import { OrganizationInviteAcceptanceStates } from "../organization-invite-acceptance.types";

beforeAll(function _InitializeAngularTesting(): void
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
});

afterEach(function _ResetAngularTesting(): void
{
	TestBed.resetTestingModule();
});

/** Build a complete gateway mock while each test controls invitation acceptance. */
function _Gateway(): OrganizationMembersGateway
{
	return { load: vi.fn(), validate: vi.fn(), invite: vi.fn(), resend: vi.fn(), accept: vi.fn() };
}

describe("organization invite acceptance store", function _OrganizationInviteAcceptanceStoreSuite()
{
	it("treats an invalid token as terminal and does not retain it for retry", async function _InvalidToken()
	{
		const gateway = _Gateway();
		vi.mocked(gateway.accept).mockRejectedValue(new OrganizationMembersGatewayError(OrganizationMembersGatewayErrorKinds.Invalid, "request body is invalid"));
		TestBed.configureTestingModule({ providers: [OrganizationInviteAcceptanceStore, { provide: ORGANIZATION_MEMBERS_GATEWAY, useValue: gateway }] });
		const store = TestBed.inject(OrganizationInviteAcceptanceStore);

		await store.accept("bad-token");
		await store.retry();

		expect(store.state()).toBe(OrganizationInviteAcceptanceStates.Invalid);
		expect(gateway.accept).toHaveBeenCalledTimes(1);
	});
});
