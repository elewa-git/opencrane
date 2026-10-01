import { randomUUID } from "node:crypto";

import { GroupMembershipAuthority, OrgMemberStatus, OrgRole, PrincipalProvenance, PrismaClient, type Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaAuthorizationAuthority, PrismaManagedAuthorizationGrantRepository, PrismaOrganizationAdminGrantBootstrapRepository } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import type { OrganizationMembershipCaller } from "../authority.types";
import { OrganizationMemberStatuses } from "../directory.types";
import { HmacOrganizationInvitationTokenAuthority } from "../invitation-token";
import { OrganizationMembershipErrorKinds } from "../organization-members.errors";
import { PrismaOrganizationMemberUnitOfWork } from "../prisma-organization-member-unit-of-work";
import { StandaloneOrganizationMembershipAuthority } from "../standalone-organization-membership-authority";

/** Keeps two server instances on independent connections to the fresh Actions database. */
const _First = new PrismaClient();
/** Exercises concurrent requests without sharing an in-memory transaction or authority. */
const _Second = new PrismaClient();

/** Uses the production membership unit of work and its default central authorization factory. */
function _Authority(prisma: PrismaClient): StandaloneOrganizationMembershipAuthority
{
	const key = Buffer.alloc(32, 7);
	const repository = new PrismaOrganizationMemberUnitOfWork(prisma);
	const tokens = new HmacOrganizationInvitationTokenAuthority(key);
	return new StandaloneOrganizationMembershipAuthority(repository, tokens, { invitationSigningKey: key, invitationTtlMilliseconds: 60_000, publicBaseUrl: "https://membership-sql.example" });
}

/** Creates a verified external identity and its membership within this test's isolated silo. */
async function _Person(transaction: Prisma.TransactionClient, siloId: string, role: OrgRole)
{
	const principalId = randomUUID();
	const subjectId = randomUUID();
	const membershipId = randomUUID();
	const email = `${subjectId}@membership-sql.example`;
	await transaction.principal.create({ data: { id: principalId, siloId, issuer: "https://membership-sql.example", subject: subjectId, provenance: PrincipalProvenance.External, email, displayName: role } });
	await transaction.orgMembership.create({ data: { id: membershipId, clusterTenant: siloId, subject: subjectId, email, displayName: role, role, status: OrgMemberStatus.Active } });
	const caller: OrganizationMembershipCaller = { siloId, principalId, subjectId, verifiedEmail: email, displayName: role };
	const bootstrap = new PrismaOrganizationAdminGrantBootstrapRepository(transaction);
	await bootstrap.reconcileOrganizationAdminGrant({ siloId, principalId, subject: subjectId, now: new Date() });
	return { membershipId, caller };
}

/**
 * Seeds a unique silo through existing production grant writers and catalogue capabilities.
 * Protected Owner rows and append-only decisions stay in the disposable Actions database; cleanup
 * must never disable their guards merely to remove a fixture.
 */
async function _Fixture()
{
	const siloId = `member-removal-sql-${randomUUID()}`;
	return _First.$transaction(async function _Seed(transaction)
	{
		const owner = await _Person(transaction, siloId, OrgRole.Owner);
		const admin = await _Person(transaction, siloId, OrgRole.Admin);
		const member = await _Person(transaction, siloId, OrgRole.Member);
		const groupId = randomUUID();
		await transaction.group.create({ data: { id: groupId, siloId, name: "Retained external claims", membershipAuthority: GroupMembershipAuthority.External } });
		await transaction.groupMembership.create({ data: { siloId, groupId, principalId: member.caller.principalId } });
		const resource = { kind: ProductAuthorizationResourceKinds.Organization, id: siloId } as const;
		const grants = [ProductAuthorizationActions.Read, ProductAuthorizationActions.Administer].map(function _Grant(action)
		{
			const capability = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.Organization, action);
			if (capability === null)
				throw new Error("The SQL fixture requires the existing organization capability catalogue");
			return { subject: { kind: AuthorizationSubjectKinds.Group, groupId }, boundary: { kind: AuthorizationBoundaryKinds.Group, groupId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId: owner.caller.principalId } as const;
		});
		const repository = new PrismaManagedAuthorizationGrantRepository(transaction);
		await repository.reconcileManagedResourceGrants({ siloId, managerId: "member-removal-sql-external-group", resource, grants, now: new Date() });
		return { siloId, owner, admin, member, groupId };
	});
}

/** Admits an actual product action without refreshing login claims or reconciling retained grants. */
async function _CurrentAdmission(prisma: PrismaClient, caller: OrganizationMembershipCaller)
{
	return prisma.$transaction(async function _Admit(transaction)
	{
		const authority = new PrismaAuthorizationAuthority(transaction);
		return authority.admitPrincipal({ siloId: caller.siloId, principalId: caller.principalId, actorKind: "user", actorId: caller.principalId, resource: { kind: ProductAuthorizationResourceKinds.Organization, id: caller.siloId }, action: ProductAuthorizationActions.Administer, argumentsDigest: ___DigestCanonicalJson({ operation: "membership_sql_admission" }), nowEpochMs: Date.now() });
	});
}

describe("member access removal on the fresh PostgreSQL baseline", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("The member removal SQL proof requires DATABASE_URL and the fresh target baseline");
		await Promise.all([_First.$connect(), _Second.$connect()]);
	});
	afterAll(async function _Disconnect() { await Promise.all([_First.$disconnect(), _Second.$disconnect()]); });

	it("persists suspension and a single removal audit when another server retries", async function _StoredRemoval()
	{
		const f = await _Fixture();
		const first = _Authority(_First);
		const second = _Authority(_Second);
		const command = { caller: f.owner.caller, membershipId: f.member.membershipId };
		const removed = await first.remove(command);
		const repeated = await second.remove(command);
		expect(repeated).toEqual(removed);
		expect(removed.member.status).toBe(OrganizationMemberStatuses.Suspended);
		const stored = await _Second.orgMembership.findUniqueOrThrow({ where: { id: f.member.membershipId } });
		expect(stored).toMatchObject({ clusterTenant: f.siloId, subject: f.member.caller.subjectId, status: OrgMemberStatus.Suspended });
		const audit = await _Second.auditEntry.findMany({ where: { siloId: f.siloId, action: "organization.member.removed", resource: f.member.membershipId } });
		expect(audit).toHaveLength(1);
		expect(audit[0]?.metadata).toMatchObject({ actorPrincipalId: f.owner.caller.principalId, actorSubject: f.owner.caller.subjectId, subjectId: f.member.caller.subjectId, previousStatus: OrganizationMemberStatuses.Active, status: OrganizationMemberStatuses.Suspended });
	});

	it("denies current admission and directory reads while old Group membership and grants remain", async function _RetainedClaims()
	{
		const f = await _Fixture();
		const before = await _CurrentAdmission(_First, f.member.caller);
		expect(before.outcome).toBe(AuthorizationDecisionOutcomes.Allow);
		const grantsBefore = await _First.authorizationGrant.count({ where: { siloId: f.siloId, subjectGroupId: f.groupId, revokedAt: null } });
		expect(grantsBefore).toBe(2);
		const authority = _Authority(_Second);
		await authority.remove({ caller: f.owner.caller, membershipId: f.member.membershipId });
		expect(await _First.groupMembership.count({ where: { siloId: f.siloId, groupId: f.groupId, principalId: f.member.caller.principalId } })).toBe(1);
		expect(await _First.authorizationGrant.count({ where: { siloId: f.siloId, subjectGroupId: f.groupId, revokedAt: null } })).toBe(grantsBefore);
		const after = await _CurrentAdmission(_First, f.member.caller);
		expect(after.outcome).toBe(AuthorizationDecisionOutcomes.Deny);
		expect(after.evidence).toBeNull();
		await expect(authority.directory(f.member.caller)).rejects.toMatchObject({ kind: OrganizationMembershipErrorKinds.Forbidden });
		await expect(authority.validate({ caller: f.member.caller, emails: ["new@membership-sql.example"] })).rejects.toMatchObject({ kind: OrganizationMembershipErrorKinds.Forbidden });
	});

	it("preserves Owner and self access through the product command and database Owner guard", async function _ProtectedMembers()
	{
		const f = await _Fixture();
		const authority = _Authority(_First);
		await expect(authority.remove({ caller: f.admin.caller, membershipId: f.owner.membershipId })).rejects.toMatchObject({ kind: OrganizationMembershipErrorKinds.Conflict });
		await expect(authority.remove({ caller: f.admin.caller, membershipId: f.admin.membershipId })).rejects.toMatchObject({ kind: OrganizationMembershipErrorKinds.Conflict });
		await expect(_Second.orgMembership.update({ where: { id: f.owner.membershipId }, data: { status: OrgMemberStatus.Suspended } })).rejects.toThrow("active organization owner");
		expect(await _Second.orgMembership.count({ where: { id: { in: [f.owner.membershipId, f.admin.membershipId] }, status: OrgMemberStatus.Active } })).toBe(2);
		expect(await _Second.auditEntry.count({ where: { siloId: f.siloId, action: "organization.member.removed" } })).toBe(0);
	});

	it("commits one removal when two independent servers race", async function _ConcurrentRemoval()
	{
		const f = await _Fixture();
		const first = _Authority(_First);
		const second = _Authority(_Second);
		const command = { caller: f.owner.caller, membershipId: f.member.membershipId };
		const results = await Promise.all([first.remove(command), second.remove(command)]);
		expect(results[0]).toEqual(results[1]);
		expect(results[0]?.member.status).toBe(OrganizationMemberStatuses.Suspended);
		expect(await _First.auditEntry.count({ where: { siloId: f.siloId, action: "organization.member.removed", resource: f.member.membershipId } })).toBe(1);
	});

	it("refuses a removed administrator's previously accepted command on retry", async function _ActorRemoved()
	{
		const f = await _Fixture();
		const first = _Authority(_First);
		const second = _Authority(_Second);
		const command = { caller: f.admin.caller, membershipId: f.member.membershipId };
		await first.remove(command);
		await second.remove({ caller: f.owner.caller, membershipId: f.admin.membershipId });
		expect(await _First.authorizationGrant.count({ where: { siloId: f.siloId, subjectPrincipalId: f.admin.caller.principalId, revokedAt: null } })).toBe(2);
		await expect(first.remove(command)).rejects.toMatchObject({ kind: OrganizationMembershipErrorKinds.Forbidden });
		expect(await _First.auditEntry.count({ where: { siloId: f.siloId, action: "organization.member.removed", resource: f.member.membershipId } })).toBe(1);
	});
});
