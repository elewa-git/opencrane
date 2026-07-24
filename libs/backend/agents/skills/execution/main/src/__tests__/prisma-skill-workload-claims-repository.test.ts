import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

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

/** Derives the controller-visible opaque reference accepted by one exact workload. */
function _BootstrapReference(workloadId: string): string
{
	return `skill-bootstrap-v1_${createHash("sha256").update(workloadId, "utf8").digest("hex")}`;
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
		await expect(repository.commitAssignmentAtomically("", { claimedAt: "not-a-time", deliveryCount: 0, workloadUid: "", bootstrapReference: "", namespace: "" })).resolves.toBe("conflict");
	});

	it("maps a duplicate immutable Kubernetes Job identity to the documented conflict result", async function _mapsDuplicateJobIdentity()
	{
		const duplicateIdentity = new Prisma.PrismaClientKnownRequestError("unique workload identity", { code: "P2002", clientVersion: "test" });
		const repository = new PrismaSkillWorkloadClaimsRepository(_RejectingPrisma(duplicateIdentity), 30_000);
		await expect(repository.commitAssignmentAtomically("workload-1", { claimedAt: "2026-07-26T05:00:00.000Z", deliveryCount: 1, workloadUid: "job-uid-1", bootstrapReference: _BootstrapReference("workload-1"), namespace: "tenant-a-authoring" })).resolves.toBe("conflict");
	});

	it("persists only the opaque bootstrap-reference hash with an exact successful Job assignment", async function _writesBootstrapHash()
	{
		const bootstrapCreate = vi.fn().mockResolvedValue({});
		const transaction = {
			$queryRaw: vi.fn().mockResolvedValueOnce([{ skillRevisionId: "revision-1" }]).mockResolvedValueOnce([{ state: "Draft" }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ now: new Date("2026-07-26T05:00:01.000Z") }]),
			skillWorkload: { findUnique: vi.fn().mockResolvedValue({ id: "workload-1", state: "Pending", kind: "Authoring", claimedAt: new Date("2026-07-26T05:00:00.000Z"), deliveryCount: 1, workloadUid: null }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			skillWorkloadBootstrap: { create: bootstrapCreate },
		};
		const prisma = { $transaction: async function _transaction(callback: (value: typeof transaction) => Promise<unknown>) { return callback(transaction); } } as never;
		const repository = new PrismaSkillWorkloadClaimsRepository(prisma, 30_000);
		const bootstrapReference = _BootstrapReference("workload-1");

		expect(await repository.commitAssignmentAtomically("workload-1", { claimedAt: "2026-07-26T05:00:00.000Z", deliveryCount: 1, workloadUid: "job-uid-1", bootstrapReference, namespace: "tenant-a-authoring" })).toBe("assigned");
		expect(bootstrapCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ skillWorkloadId: "workload-1", referenceHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/), audience: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", namespace: "tenant-a-authoring", workloadUid: "job-uid-1" }) });
		expect(JSON.stringify(bootstrapCreate.mock.calls)).not.toContain(bootstrapReference);
	});
});
