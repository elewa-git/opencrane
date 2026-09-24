import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { OrganizationInvitationCreateStore } from "../organization-invitation-create.store";
import { OrganizationInvitationResendStore } from "../organization-invitation-resend.store";
import { OrganizationMemberDirectoryStore } from "../organization-member-directory.store";
import { OrganizationMemberDirectoryStates, OrganizationMemberRemovalReasons, OrganizationMemberRemovalStates, OrganizationMemberRoles, OrganizationMemberStatuses, type OrganizationMember, type OrganizationMemberDirectory } from "../organization-member-directory.types";
import { OrganizationMemberRemovalStore } from "../organization-member-removal.store";
import { OrganizationMembersGatewayError } from "../organization-members.errors";
import { ORGANIZATION_MEMBERS_GATEWAY } from "../organization-members.gateway";
import { OrganizationMembersGatewayErrorKinds, type OrganizationMembersGateway } from "../organization-members-gateway.types";
import type { CreateOrganizationInvitationsResult, ResendOrganizationInvitationResult } from "../organization-invitations.types";

beforeAll(function _Initialize() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterEach(function _Reset() { TestBed.resetTestingModule(); });
afterAll(function _ResetEnvironment() { TestBed.resetTestEnvironment(); });

/** Allows each test to control response order without a timer or network request. */
function _Deferred<T>()
{
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

/** Creates a server-authored eligibility projection independently of its display role. */
function _Member(id = "member-1", suspended = false): OrganizationMember
{
	return { membershipId: id, displayName: id, email: `${id}@example.com`, role: OrganizationMemberRoles.Member,
		status: suspended ? OrganizationMemberStatuses.Suspended : OrganizationMemberStatuses.Active,
		joinedAt: "2026-09-01T00:00:00Z", isCurrentUser: false,
		removal: suspended ? { state: OrganizationMemberRemovalStates.Unavailable, reason: OrganizationMemberRemovalReasons.Inactive } : { state: OrganizationMemberRemovalStates.Available } };
}

/** Creates the current server directory with two independently removable targets. */
function _Directory(): OrganizationMemberDirectory
{
	return { members: [_Member(), _Member("member-2")], invitations: [], activeCount: 2, pendingCount: 0 };
}

/** Runs Angular's resource/effect scheduling, then permits promise continuations to finish. */
async function _Flush(): Promise<void>
{
	TestBed.tick();
	await Promise.resolve();
	await Promise.resolve();
	TestBed.tick();
}

/** Composes the actual read and command stores against a controlled ordinary-session gateway. */
async function _Fixture()
{
	const gateway: OrganizationMembersGateway = { load: vi.fn().mockResolvedValue(_Directory()), remove: vi.fn(), invite: vi.fn(), resend: vi.fn(), validate: vi.fn(), accept: vi.fn() };
	TestBed.configureTestingModule({ providers: [OrganizationMemberDirectoryStore, OrganizationMemberRemovalStore, OrganizationInvitationCreateStore, OrganizationInvitationResendStore, { provide: ORGANIZATION_MEMBERS_GATEWAY, useValue: gateway }] });
	const directory = TestBed.inject(OrganizationMemberDirectoryStore);
	const removal = TestBed.inject(OrganizationMemberRemovalStore);
	const create = TestBed.inject(OrganizationInvitationCreateStore);
	const resend = TestBed.inject(OrganizationInvitationResendStore);
	await _Flush();
	expect(directory.state()).toBe(OrganizationMemberDirectoryStates.Ready);
	return { gateway, directory, removal, create, resend };
}

describe("member directory and removal authority isolation", function _Suite()
{
	it("retains temporary refresh failure but purges rows and resource values on Forbidden", async function _RefreshFailure()
	{
		const f = await _Fixture();
		vi.mocked(f.gateway.load).mockRejectedValueOnce(new Error("temporary"));
		f.directory.refresh(); await _Flush();
		expect(f.directory.state()).toBe(OrganizationMemberDirectoryStates.RetainedRefreshError);
		expect(f.directory.directory()?.members).toHaveLength(2);
		vi.mocked(f.gateway.load).mockRejectedValueOnce(new OrganizationMembersGatewayError(OrganizationMembersGatewayErrorKinds.Forbidden, "denied"));
		f.directory.refresh(); await _Flush();
		expect(f.directory.state()).toBe(OrganizationMemberDirectoryStates.Forbidden);
		expect(f.directory.directory()).toBeNull();
		expect(f.directory.resource.value()).toBeNull();
		await f.removal.remove("member-1");
		expect(f.gateway.remove).not.toHaveBeenCalled();
	});

	it("ignores a directory response begun before a command proves access loss", async function _LateDirectory()
	{
		const f = await _Fixture();
		const load = _Deferred<OrganizationMemberDirectory>();
		vi.mocked(f.gateway.load).mockReturnValueOnce(load.promise);
		f.directory.refresh(); await _Flush();
		f.directory.forbid();
		load.resolve(_Directory()); await _Flush();
		expect(f.directory.directory()).toBeNull();
		expect(f.directory.state()).toBe(OrganizationMemberDirectoryStates.Forbidden);
	});

	it("adopts the exact Suspended row before an older refresh can restore Active", async function _Adoption()
	{
		const f = await _Fixture();
		const load = _Deferred<OrganizationMemberDirectory>();
		vi.mocked(f.gateway.load).mockReturnValueOnce(load.promise);
		f.directory.refresh(); await _Flush();
		vi.mocked(f.gateway.remove).mockResolvedValueOnce(_Member("member-1", true));
		await f.removal.remove("member-1");
		load.resolve(_Directory()); await _Flush();
		expect(f.directory.directory()?.members[0]?.status).toBe(OrganizationMemberStatuses.Suspended);
		expect(f.directory.directory()?.activeCount).toBe(1);
		expect(f.removal.message()).toContain("access removed");
		vi.mocked(f.gateway.load).mockResolvedValueOnce({ ..._Directory(), members: [_Member("member-1", true), _Member("member-2")], activeCount: 1 });
		f.directory.refresh(); await _Flush();
		expect(f.directory.directory()?.members[0]?.status).toBe(OrganizationMemberStatuses.Suspended);
	});

	it("locks only the exact target and admits independent member removals", async function _ConcurrentTargets()
	{
		const f = await _Fixture();
		const first = _Deferred<OrganizationMember>();
		const second = _Deferred<OrganizationMember>();
		vi.mocked(f.gateway.remove).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		const a = f.removal.remove("member-1");
		await f.removal.remove("member-1");
		const b = f.removal.remove("member-2");
		await f.removal.remove("foreign");
		expect(f.gateway.remove).toHaveBeenCalledTimes(2);
		expect(f.removal.busyIds().size).toBe(2);
		first.resolve(_Member("member-1", true)); await a;
		expect([...f.removal.busyIds()]).toEqual(["member-2"]);
		second.resolve(_Member("member-2", true)); await b;
		expect(f.directory.directory()?.activeCount).toBe(0);
	});

	it.each(Object.values(OrganizationMemberRemovalReasons))("does not infer permission over server protection %s", async function _Protected(reason)
	{
		const f = await _Fixture();
		f.directory.adopt({ ..._Member(), removal: { state: OrganizationMemberRemovalStates.Unavailable, reason } }, f.directory.accessGeneration());
		await f.removal.remove("member-1");
		expect(f.gateway.remove).not.toHaveBeenCalled();
	});

	it("rejects a returned foreign member and refreshes after uncertain response loss", async function _WrongReturn()
	{
		const f = await _Fixture();
		vi.mocked(f.gateway.remove).mockResolvedValueOnce(_Member("foreign", true)).mockRejectedValueOnce(new Error("lost response"));
		await f.removal.remove("member-1"); await _Flush();
		expect(f.directory.directory()?.members[0]?.membershipId).toBe("member-1");
		expect(f.removal.message()).toBeNull();
		vi.mocked(f.gateway.load).mockResolvedValueOnce({ ..._Directory(), members: [_Member("member-1", true)], activeCount: 0 });
		await f.removal.remove("member-1"); await _Flush();
		expect(f.directory.directory()?.members[0]?.status).toBe(OrganizationMemberStatuses.Suspended);
		expect(f.removal.error()).toContain("could not be confirmed");
	});

	it("does not let an old command clear or adopt over a newer command after access is restored", async function _LateCommand()
	{
		const f = await _Fixture();
		const old = _Deferred<OrganizationMember>();
		const current = _Deferred<OrganizationMember>();
		vi.mocked(f.gateway.remove).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
		const first = f.removal.remove("member-1");
		f.directory.forbid(); await _Flush();
		f.directory.refresh(); await _Flush();
		const second = f.removal.remove("member-1");
		old.resolve(_Member("member-1", true)); await first;
		expect(f.directory.directory()?.members[0]?.status).toBe(OrganizationMemberStatuses.Active);
		expect(f.removal.busyIds().has("member-1")).toBe(true);
		current.resolve(_Member("member-1", true)); await second;
		expect(f.directory.directory()?.members[0]?.status).toBe(OrganizationMemberStatuses.Suspended);
	});

	it("purges all invitation links and rejects late create/resend results after removal denial", async function _LateInvitations()
	{
		const f = await _Fixture();
		const create = _Deferred<CreateOrganizationInvitationsResult>();
		const resend = _Deferred<ResendOrganizationInvitationResult>();
		vi.mocked(f.gateway.validate).mockResolvedValue({ recipients: [{ email: "alex@example.com", normalizedEmail: "alex@example.com", valid: true }] });
		vi.mocked(f.gateway.invite).mockReturnValue(create.promise);
		vi.mocked(f.gateway.resend).mockReturnValue(resend.promise);
		const creating = f.create.invite(["alex@example.com"], OrganizationMemberRoles.Member);
		const resending = f.resend.resend("invite-1");
		await _Flush();
		vi.mocked(f.gateway.remove).mockRejectedValueOnce(new OrganizationMembersGatewayError(OrganizationMembersGatewayErrorKinds.Forbidden, "denied"));
		await f.removal.remove("member-1"); await _Flush();
		create.resolve({ invitations: [], createdCount: 0, inviteLinks: ["https://private.example/invite"] });
		resend.resolve({ invitation: { invitationId: "invite-1" } as ResendOrganizationInvitationResult["invitation"], inviteLink: "https://private.example/rotated" });
		await Promise.all([creating, resending]); await _Flush();
		expect(f.directory.directory()).toBeNull();
		expect(f.create.result()).toBeNull();
		expect(f.resend.invitations()).toEqual([]);
		expect(f.resend.link()).toBeNull();
		expect(f.resend.busyIds().size).toBe(0);
	});
});
