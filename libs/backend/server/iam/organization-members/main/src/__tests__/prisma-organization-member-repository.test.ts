import { OrgMemberStatus, OrgRole, OrganizationInvitationStatus, Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";

import { OrganizationMemberRoles } from "../directory.types";
import { OrganizationMembershipErrorKinds } from "../organization-members.errors";
import { PrismaOrganizationMemberUnitOfWork } from "../prisma-organization-member-unit-of-work";

/** Verified Principal with a current organisation administration grant. */
const _CALLER = { siloId: "acme", principalId: "principal-admin-1", subjectId: "admin-1", verifiedEmail: "admin@acme.test", displayName: "Admin" };

/** Stored pending invitation fixture. */
function _Invitation(overrides: Record<string, unknown> = {})
{
	return { id: "invite-1", siloId: "acme", email: "new@acme.test", role: OrgRole.Member, status: OrganizationInvitationStatus.Pending, generation: 1, tokenNonce: "abcdefghijklmnop", expiresAt: new Date("2026-08-18T00:00:00.000Z"), invitedAt: new Date("2026-08-17T00:00:00.000Z"), invitedByDisplayName: "Admin", lastResendIdempotencyKey: null, ...overrides };
}

/** Builds a Prisma P2002 error without depending on a real database. */
function _UniqueConflict(): Prisma.PrismaClientKnownRequestError
{
	return new Prisma.PrismaClientKnownRequestError("unique conflict", { code: "P2002", clientVersion: "6.19.3" });
}

/** Allows focused repository tests without reproducing central grant persistence. */
function _Authorization(): AuthorizationAuthority
{
	const decision = { outcome: AuthorizationDecisionOutcomes.Allow, reason: "winning_allow" as const, grantIds: ["grant-1"], rule: null, evidence: null };
	return {
		decide: vi.fn().mockResolvedValue(decision),
		admit: vi.fn().mockResolvedValue(decision),
		admitPrincipal: vi.fn().mockResolvedValue(decision),
		listEntitled: vi.fn(async command => command.resources),
		listPrincipalEntitled: vi.fn(async command => command.resources),
		listManagedGrants: vi.fn().mockResolvedValue([]),
		replaceManagedGrants: vi.fn().mockResolvedValue({ ...decision, changedCount: 0 }),
	};
}

/** Constructs a local unit of work with one transaction-bound test authority. */
function _UnitOfWork(prisma: PrismaClient, authorization: AuthorizationAuthority = _Authorization()): PrismaOrganizationMemberUnitOfWork
{
	return new PrismaOrganizationMemberUnitOfWork(prisma, function _AuthorityFactory() { return authorization; });
}

describe("PrismaOrganizationMemberRepository concurrency", function _Suite()
{
	it.each([
		[OrgMemberStatus.Active, true],
		[OrgMemberStatus.Suspended, false],
		[null, false],
	] as const)("binds product access to the exact subject and silo for membership state %s", async function _CurrentMembership(status, expected)
	{
		const findUnique = vi.fn().mockResolvedValue(status === null ? null : { status });
		const transaction = { orgMembership: { findUnique } };
		const prisma = { $transaction: vi.fn(async function _Transaction(callback) { return callback(transaction); }) } as unknown as PrismaClient;

		await expect(_UnitOfWork(prisma).hasActiveMembership({ siloId: "acme", subjectId: "member-1" })).resolves.toBe(expected);

		expect(findUnique).toHaveBeenCalledWith({ where: { clusterTenant_subject: { clusterTenant: "acme", subject: "member-1" } }, select: { status: true } });
	});

	it("uses the exact organization administer grant instead of an Owner or Admin role query", async function _CentralAdministration()
	{
		const transaction = {
			orgMembership: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), findFirst: vi.fn() },
			organizationInvitation: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(callback) { return callback(transaction); }) } as unknown as PrismaClient;
		const authorization = _Authorization();

		await _UnitOfWork(prisma, authorization).directory(_CALLER);

		expect(authorization.listPrincipalEntitled).toHaveBeenCalledWith(expect.objectContaining({ siloId: "acme", principalId: "principal-admin-1", action: "administer", resources: [{ kind: "organization", id: "acme" }] }));
		expect(transaction.orgMembership.findFirst).not.toHaveBeenCalled();
	});

	it("denies an invitation mutation before persistence when current authorization is absent", async function _DeniedCreate()
	{
		const transaction = { organizationInvitationRequest: { findUnique: vi.fn() }, organizationInvitation: { create: vi.fn() } };
		const prisma = { $transaction: vi.fn(async function _Transaction(callback) { return callback(transaction); }) } as unknown as PrismaClient;
		const denied = _Authorization();
		vi.mocked(denied.admitPrincipal).mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Deny, reason: "no_matching_grant", grantIds: [], rule: null, evidence: null });

		await expect(_UnitOfWork(prisma, denied).create({ caller: _CALLER, role: OrganizationMemberRoles.Member, idempotencyKey: "0123456789abcdef", payloadDigest: "sha256:denied", drafts: [], invitedAt: new Date(), expiresAt: new Date() })).rejects.toMatchObject({ kind: OrganizationMembershipErrorKinds.Forbidden });

		expect(denied.admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ resource: { kind: "organization", id: "acme" }, action: "administer" }));
		expect(transaction.organizationInvitationRequest.findUnique).not.toHaveBeenCalled();
	});

	it("recovers the exact stored result after a same-key create race", async function _SameKey()
	{
		const recoveryTransaction = {
			organizationInvitationRequest: { findUnique: vi.fn().mockResolvedValue({ payloadDigest: "sha256:same", resultInvitationIds: ["invite-1"] }) },
			organizationInvitation: { findMany: vi.fn().mockResolvedValue([_Invitation()]) },
		};
		const prisma = { $transaction: vi.fn().mockRejectedValueOnce(_UniqueConflict()).mockImplementation(async function _Recover(callback) { return callback(recoveryTransaction); }) } as unknown as PrismaClient;
		const result = await _UnitOfWork(prisma).create({ caller: _CALLER, role: OrganizationMemberRoles.Member, idempotencyKey: "0123456789abcdef", payloadDigest: "sha256:same", drafts: [], invitedAt: new Date(), expiresAt: new Date() });
		expect(result.createdCount).toBe(0);
		expect(result.invitations[0]?.invitationId).toBe("invite-1");
	});

	it("maps a different-key or different-payload create race to stable conflict", async function _Conflict()
	{
		const recoveryTransaction = { organizationInvitationRequest: { findUnique: vi.fn().mockResolvedValue(null) } };
		const prisma = { $transaction: vi.fn().mockRejectedValueOnce(_UniqueConflict()).mockImplementation(async function _Recover(callback) { return callback(recoveryTransaction); }) } as unknown as PrismaClient;
		await expect(_UnitOfWork(prisma).create({ caller: _CALLER, role: OrganizationMemberRoles.Member, idempotencyKey: "0123456789abcdef", payloadDigest: "sha256:new", drafts: [], invitedAt: new Date(), expiresAt: new Date() })).rejects.toMatchObject({ kind: OrganizationMembershipErrorKinds.Conflict });
	});

	it("recovers the winning generation when the same resend key races", async function _ResendRace()
	{
		const invitation = _Invitation();
		const transaction = {
			orgMembership: { findFirst: vi.fn().mockResolvedValue({ id: "admin-membership" }) },
			organizationInvitation: {
				findUnique: vi.fn().mockResolvedValueOnce(invitation).mockResolvedValueOnce(_Invitation({ generation: 2, tokenNonce: "newnonceabcdefghijkl", lastResendIdempotencyKey: "0123456789abcdef" })),
				updateMany: vi.fn().mockResolvedValue({ count: 0 }),
			},
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(callback) { return callback(transaction); }) } as unknown as PrismaClient;
		const result = await _UnitOfWork(prisma).resend({ caller: _CALLER, invitationId: "invite-1", idempotencyKey: "0123456789abcdef", nonce: "newnonceabcdefghijkl", invitedAt: new Date(), expiresAt: new Date() });
		expect(result.generation).toBe(2);
		expect(transaction.organizationInvitation.updateMany).toHaveBeenCalledTimes(1);
	});

	it("recovers an accepted membership after the same subject loses the first response", async function _AcceptanceRetry()
	{
		const membership = { id: "member-1", subject: "new-subject", email: "new@acme.test", displayName: "New", role: OrgRole.Member, status: OrgMemberStatus.Active, createdAt: new Date("2026-08-17T00:00:00.000Z") };
		const transaction = {
			organizationInvitation: { findUnique: vi.fn().mockResolvedValue(_Invitation({ status: OrganizationInvitationStatus.Accepted, acceptedBySubject: "new-subject" })), updateMany: vi.fn() },
			orgMembership: { findUnique: vi.fn().mockResolvedValue(membership), create: vi.fn() },
			auditEntry: { create: vi.fn() },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(callback) { return callback(transaction); }) } as unknown as PrismaClient;
		const result = await _UnitOfWork(prisma).accept({ caller: { siloId: "acme", principalId: "principal-new", subjectId: "new-subject", verifiedEmail: "new@acme.test", displayName: "New" }, coordinates: { invitationId: "invite-1", generation: 1, nonce: "abcdefghijklmnop" }, acceptedAt: new Date("2026-08-17T00:01:00.000Z") });
		expect(result).toMatchObject({ membershipId: "member-1", email: "new@acme.test", isCurrentUser: true });
		expect(transaction.organizationInvitation.updateMany).not.toHaveBeenCalled();
		expect(transaction.orgMembership.create).not.toHaveBeenCalled();
		expect(transaction.auditEntry.create).not.toHaveBeenCalled();
	});

	it("keeps an accepted invitation fail-closed for another subject", async function _AcceptanceMismatch()
	{
		const transaction = {
			organizationInvitation: { findUnique: vi.fn().mockResolvedValue(_Invitation({ status: OrganizationInvitationStatus.Accepted, acceptedBySubject: "other-subject" })) },
			orgMembership: { findUnique: vi.fn() },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(callback) { return callback(transaction); }) } as unknown as PrismaClient;
		await expect(_UnitOfWork(prisma).accept({ caller: { siloId: "acme", principalId: "principal-new", subjectId: "new-subject", verifiedEmail: "new@acme.test", displayName: "New" }, coordinates: { invitationId: "invite-1", generation: 1, nonce: "abcdefghijklmnop" }, acceptedAt: new Date() })).rejects.toMatchObject({ kind: OrganizationMembershipErrorKinds.AlreadyUsed });
		expect(transaction.orgMembership.findUnique).not.toHaveBeenCalled();
	});
});
