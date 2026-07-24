import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { PrismaSkillWorkloadClaimsRepository } from "../prisma-skill-workload-claims-repository.js";

/** Builds the minimal unused Prisma seam needed to exercise pre-transaction guards. */
function _Prisma(): never
{
	return {} as never;
}

/** Builds a transaction seam that returns one expected database concurrency failure. */
function _RejectingPrisma(error: Error): never
{
	return { $transaction: async function _rejectTransaction(): Promise<never> { throw error; } } as never;
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

	it("maps a duplicate immutable Kubernetes Job identity to the documented conflict result", async function _mapsDuplicateJobIdentity()
	{
		const duplicateIdentity = new Prisma.PrismaClientKnownRequestError("unique workload identity", { code: "P2002", clientVersion: "test" });
		const repository = new PrismaSkillWorkloadClaimsRepository(_RejectingPrisma(duplicateIdentity), 30_000);
		await expect(repository.commitAssignmentAtomically("workload-1", { claimedAt: "2026-07-26T05:00:00.000Z", deliveryCount: 1, workloadUid: "job-uid-1" })).resolves.toBe("conflict");
	});
});
