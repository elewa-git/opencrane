import { OrgMemberStatus, OrgRole, Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { OrganizationMemberStatuses } from "../directory.types";
import { OrganizationMembershipErrorKinds } from "../organization-members.errors";
import { PrismaOrganizationMemberUnitOfWork } from "../prisma-organization-member-unit-of-work";
import { OrganizationMemberRemovalStates, OrganizationMemberRemovalUnavailableReasons } from "../removal.types";

/** Uses a verified administrator whose identity is independent of the target path. */
const _CALLER = { siloId: "acme", principalId: "principal-admin", subjectId: "admin", verifiedEmail: "admin@acme.test", displayName: "Admin" };

/** Supplies a stored membership with stable identity and original join time. */
function _Member(role: OrgRole = OrgRole.Member, status: OrgMemberStatus = OrgMemberStatus.Active, subject = "member")
{
	return { id: `membership-${subject}`, clusterTenant: "acme", subject, email: `${subject}@acme.test`, displayName: subject, role, status, createdAt: new Date("2026-09-01T00:00:00.000Z") };
}

/** Models repository storage while recording the exact transaction used by the authority factory. */
function _Fixture()
{
	const state = { actor: _Member(OrgRole.Admin, OrgMemberStatus.Active, "admin") as ReturnType<typeof _Member> | null, target: _Member() as ReturnType<typeof _Member> | null };
	const decision = { outcome: AuthorizationDecisionOutcomes.Allow, reason: "winning_allow", grantIds: ["grant"], rule: null, evidence: null };
	const authorization = { decidePrincipal: vi.fn().mockResolvedValue(decision), admitPrincipal: vi.fn().mockResolvedValue(decision), listPrincipalEntitled: vi.fn().mockResolvedValue([{ kind: ProductAuthorizationResourceKinds.Organization, id: "acme" }]) };
	const transaction = {
		orgMembership: {
			findUnique: vi.fn(async function _Actor() { return state.actor; }),
			findFirst: vi.fn(async function _Target(query: { where: { id: string; clusterTenant: string } })
			{
				return state.target?.id === query.where.id && state.target.clusterTenant === query.where.clusterTenant ? { ...state.target } : null;
			}),
			findMany: vi.fn(async function _Members() { return [state.actor, state.target].filter(member => member !== null); }),
			count: vi.fn().mockResolvedValue(2),
			updateMany: vi.fn(async function _Suspend()
			{
				if (state.target !== null)
					state.target = { ...state.target, status: OrgMemberStatus.Suspended };
				return { count: 1 };
			}),
		},
		organizationInvitation: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
		auditEntry: { create: vi.fn().mockResolvedValue({}) },
	};
	const prisma = { $transaction: vi.fn(async function _Transaction(work: (client: Prisma.TransactionClient) => Promise<unknown>) { return work(transaction as unknown as Prisma.TransactionClient); }) };
	const authorityTransactions: Prisma.TransactionClient[] = [];
	const unit = new PrismaOrganizationMemberUnitOfWork(prisma as unknown as PrismaClient, function _Authority(client)
	{
		authorityTransactions.push(client);
		return authorization as unknown as AuthorizationAuthority;
	});
	const command = { caller: _CALLER, membershipId: "membership-member", removedAt: new Date() };
	return { state, authorization, transaction, prisma, authorityTransactions, unit, command };
}

/** Represents a PostgreSQL serialization failure that proves the transaction rolled back. */
function _SerializationConflict(): Prisma.PrismaClientKnownRequestError
{
	return new Prisma.PrismaClientKnownRequestError("concurrent removal", { code: "P2034", clientVersion: "6.19.3" });
}

describe("standalone member access removal", function _Suite()
{
	it("admits the exact suspension with its audit in one Serializable transaction", async function _Suspend()
	{
		const f = _Fixture();
		const result = await f.unit.remove(f.command);
		expect(result).toMatchObject({ membershipId: "membership-member", status: OrganizationMemberStatuses.Suspended, joinedAt: "2026-09-01T00:00:00.000Z", removal: { state: OrganizationMemberRemovalStates.Unavailable, reason: OrganizationMemberRemovalUnavailableReasons.Inactive } });
		expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
		expect(f.authorityTransactions).toEqual([f.transaction]);
		expect(f.authorization.admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ siloId: "acme", principalId: "principal-admin", actorId: "principal-admin", action: ProductAuthorizationActions.Administer, resource: { kind: ProductAuthorizationResourceKinds.Organization, id: "acme" }, argumentsDigest: ___DigestCanonicalJson({ operation: "remove_member", membershipId: "membership-member", subjectId: "member", previousStatus: OrganizationMemberStatuses.Active, status: OrganizationMemberStatuses.Suspended }) }));
		expect(f.transaction.orgMembership.updateMany).toHaveBeenCalledWith({ where: { id: "membership-member", clusterTenant: "acme", subject: "member", role: OrgRole.Member, status: OrgMemberStatus.Active }, data: { status: OrgMemberStatus.Suspended, updatedAt: expect.any(Date) } });
		expect(f.transaction.auditEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ siloId: "acme", action: "organization.member.removed", resource: "membership-member", metadata: expect.objectContaining({ actorSubject: "admin", actorPrincipalId: "principal-admin", subjectId: "member" }) }) });
		expect(f.authorization.admitPrincipal.mock.invocationCallOrder[0]).toBeLessThan(f.transaction.orgMembership.updateMany.mock.invocationCallOrder[0]!);
	});

	it("returns the suspended row on retry without a second membership removal audit", async function _Idempotent()
	{
		const f = _Fixture();
		const first = await f.unit.remove(f.command);
		const repeated = await f.unit.remove(f.command);
		expect(repeated).toEqual(first);
		expect(f.authorization.admitPrincipal).toHaveBeenCalledTimes(2);
		expect(f.transaction.orgMembership.findUnique).toHaveBeenCalledTimes(2);
		expect(f.transaction.orgMembership.updateMany).toHaveBeenCalledTimes(1);
		expect(f.transaction.auditEntry.create).toHaveBeenCalledTimes(1);
	});

	it.each([null, _Member(OrgRole.Admin, OrgMemberStatus.Suspended, "admin"), _Member(OrgRole.Member, OrgMemberStatus.Active, "admin")])("denies an ineligible actor despite a stale allow grant", async function _ActorDenied(actor)
	{
		const f = _Fixture();
		f.state.actor = actor;
		await expect(f.unit.remove(f.command)).rejects.toMatchObject({ kind: OrganizationMembershipErrorKinds.Forbidden });
		expect(f.transaction.orgMembership.findFirst).not.toHaveBeenCalled();
		expect(f.authorization.admitPrincipal).not.toHaveBeenCalled();
		expect(f.transaction.orgMembership.updateMany).not.toHaveBeenCalled();
	});

	it.each(["decidePrincipal", "admitPrincipal"] as const)("requires central %s authority before writing", async function _CentralDeny(method)
	{
		const f = _Fixture();
		f.authorization[method].mockResolvedValueOnce({ outcome: AuthorizationDecisionOutcomes.Deny });
		await expect(f.unit.remove(f.command)).rejects.toMatchObject({ kind: OrganizationMembershipErrorKinds.Forbidden });
		expect(f.transaction.orgMembership.updateMany).not.toHaveBeenCalled();
		expect(f.transaction.auditEntry.create).not.toHaveBeenCalled();
	});

	it.each([_Member(OrgRole.Owner), _Member(OrgRole.Admin, OrgMemberStatus.Active, "admin")])("protects an Owner or the caller's own row", async function _Protected(target)
	{
		const f = _Fixture();
		f.state.target = target;
		await expect(f.unit.remove({ ...f.command, membershipId: target.id })).rejects.toMatchObject({ kind: OrganizationMembershipErrorKinds.Conflict });
		expect(f.authorization.admitPrincipal).not.toHaveBeenCalled();
		expect(f.transaction.orgMembership.updateMany).not.toHaveBeenCalled();
	});

	it.each([null, { ..._Member(), clusterTenant: "other" }])("does not distinguish foreign from missing target", async function _Foreign(target)
	{
		const f = _Fixture();
		f.state.target = target;
		await expect(f.unit.remove(f.command)).rejects.toMatchObject({ kind: OrganizationMembershipErrorKinds.NotFound });
		expect(f.transaction.orgMembership.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "membership-member", clusterTenant: "acme" } }));
		expect(f.transaction.orgMembership.updateMany).not.toHaveBeenCalled();
	});

	it("offers removal only after pure Administer eligibility, without recording an effect", async function _Directory()
	{
		const f = _Fixture();
		const allowed = await f.unit.directory(_CALLER);
		expect(allowed.members[1]?.removal).toEqual({ state: OrganizationMemberRemovalStates.Available });
		f.authorization.decidePrincipal.mockResolvedValueOnce({ outcome: AuthorizationDecisionOutcomes.Deny });
		const denied = await f.unit.directory(_CALLER);
		expect(denied.members[1]?.removal).toEqual({ state: OrganizationMemberRemovalStates.Unavailable, reason: OrganizationMemberRemovalUnavailableReasons.NotAuthorized });
		expect(f.authorization.admitPrincipal).not.toHaveBeenCalled();
	});

	it("recovers a concurrent removal from a fresh transaction", async function _Concurrent()
	{
		const f = _Fixture();
		f.prisma.$transaction.mockImplementationOnce(async function _RolledBack(work)
		{
			await work(f.transaction as unknown as Prisma.TransactionClient);
			// PostgreSQL discarded this attempt; another writer has already suspended the same row.
			f.transaction.auditEntry.create.mockClear();
			throw _SerializationConflict();
		});
		const result = await f.unit.remove(f.command);
		expect(result.status).toBe(OrganizationMemberStatuses.Suspended);
		expect(f.prisma.$transaction).toHaveBeenCalledTimes(2);
		expect(f.transaction.orgMembership.findUnique).toHaveBeenCalledTimes(2);
		expect(f.transaction.auditEntry.create).not.toHaveBeenCalled();
	});

	it("refuses a retry when its administrator was removed after rollback", async function _ActorRemovedDuringRetry()
	{
		const f = _Fixture();
		f.prisma.$transaction.mockImplementationOnce(async function _RolledBack(work)
		{
			await work(f.transaction as unknown as Prisma.TransactionClient);
			f.state.target = _Member();
			f.state.actor = _Member(OrgRole.Admin, OrgMemberStatus.Suspended, "admin");
			f.transaction.auditEntry.create.mockClear();
			throw _SerializationConflict();
		});
		await expect(f.unit.remove(f.command)).rejects.toMatchObject({ kind: OrganizationMembershipErrorKinds.Forbidden });
		expect(f.prisma.$transaction).toHaveBeenCalledTimes(2);
		expect(f.state.target?.status).toBe(OrgMemberStatus.Active);
		expect(f.transaction.auditEntry.create).not.toHaveBeenCalled();
	});

	it("returns conflict after the bounded serialization retry budget is exhausted", async function _Exhausted()
	{
		const f = _Fixture();
		f.prisma.$transaction.mockRejectedValue(_SerializationConflict());
		await expect(f.unit.remove(f.command)).rejects.toMatchObject({ kind: OrganizationMembershipErrorKinds.Conflict });
		expect(f.prisma.$transaction).toHaveBeenCalledTimes(3);
	});
});
