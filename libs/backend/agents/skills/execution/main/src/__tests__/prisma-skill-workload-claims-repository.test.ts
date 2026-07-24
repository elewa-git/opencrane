import { describe, expect, it } from "vitest";

import { PrismaSkillWorkloadClaimsRepository } from "../prisma-skill-workload-claims-repository.js";

/** Builds the minimal unused Prisma seam needed to exercise pre-transaction guards. */
function _Prisma(): never
{
	return {} as never;
}

describe("governed skill workload claims", function _describeClaims()
{
	it("rejects unbounded claim leases before a database transaction starts", function _rejectsLease()
	{
		expect(function _zeroLease() { new PrismaSkillWorkloadClaimsRepository(_Prisma(), 0); }).toThrow(/lease must be bounded/);
		expect(function _longLease() { new PrismaSkillWorkloadClaimsRepository(_Prisma(), 300_001); }).toThrow(/lease must be bounded/);
	});

	it("rejects malformed controller assignment generations before a database transaction starts", async function _rejectsMalformedAssignment()
	{
		const repository = new PrismaSkillWorkloadClaimsRepository(_Prisma(), 30_000);
		await expect(repository.commitAssignmentAtomically("", { claimedAt: "not-a-time", deliveryCount: 0, workloadUid: "" })).resolves.toBe("conflict");
	});
});
