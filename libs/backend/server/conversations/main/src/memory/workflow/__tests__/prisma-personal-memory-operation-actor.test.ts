import { OrgMemberStatus, PrincipalProvenance, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaPersonalMemoryOperationActorRepository } from "../prisma-personal-memory-operation-actor-repository";

/** Creates the two delegates used by the actor repository. */
function _Fixture()
{
	const transaction = {
		principal: { findFirst: vi.fn().mockResolvedValue({ id: "principal-1", issuer: "https://issuer.test", subject: "subject-1" }) },
		orgMembership: { findUnique: vi.fn().mockResolvedValue({ status: OrgMemberStatus.Active }) },
	};
	return { transaction, repository: new PrismaPersonalMemoryOperationActorRepository(transaction as unknown as Prisma.TransactionClient) };
}

describe("personal memory operation actor repository", function _Suite()
{
	it("returns exact persisted issuer and subject for one active external principal", async function _Active()
	{
		const f = _Fixture();
		await expect(f.repository.resolve("silo-1", "principal-1")).resolves.toEqual({ siloId: "silo-1", principalId: "principal-1", subjectId: "subject-1", externalIssuer: "https://issuer.test" });
		expect(f.transaction.principal.findFirst).toHaveBeenCalledWith({ where: { id: "principal-1", siloId: "silo-1", provenance: PrincipalProvenance.External }, select: { id: true, issuer: true, subject: true } });
		expect(f.transaction.orgMembership.findUnique).toHaveBeenCalledWith({ where: { clusterTenant_subject: { clusterTenant: "silo-1", subject: "subject-1" } }, select: { status: true } });
	});

	it.each([
		[null, { status: OrgMemberStatus.Active }],
		[{ id: "principal-1", issuer: "", subject: "subject-1" }, { status: OrgMemberStatus.Active }],
		[{ id: "principal-1", issuer: "https://issuer.test", subject: " " }, { status: OrgMemberStatus.Active }],
		[{ id: "principal-1", issuer: "https://issuer.test", subject: "subject-1" }, null],
		[{ id: "principal-1", issuer: "https://issuer.test", subject: "subject-1" }, { status: OrgMemberStatus.Suspended }],
	])("rejects unavailable, malformed, or inactive actor evidence %#", async function _Denied(principal, membership)
	{
		const f = _Fixture();
		f.transaction.principal.findFirst.mockResolvedValue(principal);
		f.transaction.orgMembership.findUnique.mockResolvedValue(membership);
		await expect(f.repository.resolve("silo-1", "principal-1")).resolves.toBeNull();
	});
});
