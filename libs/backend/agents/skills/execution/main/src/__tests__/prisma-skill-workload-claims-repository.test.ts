import { describe, expect, it, vi } from "vitest";

import { PrismaSkillWorkloadClaimsRepository } from "../prisma-skill-workload-claims-repository.js";

/** Builds the minimal unused Prisma seam needed to exercise pre-transaction guards. */
function _Prisma(): never
{
	return {} as never;
}

/** Fixed opaque reference that is safe to expose to the controller test double. */
const _BOOTSTRAP_REFERENCE = `skill-bootstrap-v1_${"a".repeat(64)}`;

/** Build the minimal pending record accepted by the assignment authority. */
function _PendingWorkload()
{
	return { id: "workload-1", state: "Pending", kind: "Authoring", claimedAt: new Date("2026-07-24T00:00:00.000Z"), deliveryCount: 1, workloadUid: null };
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
		await expect(repository.commitAssignmentAtomically("", { claimedAt: "not-a-time", deliveryCount: 0, workloadUid: "", bootstrapReference: "" })).resolves.toBe("conflict");
	});

	it("rejects a same-grammar bootstrap reference derived for a different workload", async function _rejectsForeignBootstrap()
	{
		const repository = new PrismaSkillWorkloadClaimsRepository(_Prisma(), 30_000);

		await expect(repository.commitAssignmentAtomically("workload-1", { claimedAt: "2026-07-24T00:00:00.000Z", deliveryCount: 1, workloadUid: "job-uid-1", bootstrapReference: _BOOTSTRAP_REFERENCE })).resolves.toBe("conflict");
	});

	it("writes only the bootstrap-reference hash alongside one successful Job-UID assignment", async function _writesHashedBootstrap()
	{
		const bootstrapCreate = vi.fn().mockResolvedValue({});
		const transaction = {
			$queryRaw: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ now: new Date("2026-07-24T00:00:01.000Z") }]),
			skillWorkload: { findUnique: vi.fn().mockResolvedValue(_PendingWorkload()), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			skillWorkloadBootstrap: { create: bootstrapCreate },
		};
		const prisma = { $transaction: async function _transaction(callback: (value: typeof transaction) => Promise<unknown>) { return callback(transaction); } } as never;
		const repository = new PrismaSkillWorkloadClaimsRepository(prisma, 30_000);

		const bootstrapReference = "skill-bootstrap-v1_11c0f0700da1dc7f2be926ca093583228b65d0637ae3f0ba9ddd27ace6d30f34";
		expect(await repository.commitAssignmentAtomically("workload-1", { claimedAt: "2026-07-24T00:00:00.000Z", deliveryCount: 1, workloadUid: "job-uid-1", bootstrapReference })).toBe("assigned");
		expect(bootstrapCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ skillWorkloadId: "workload-1", referenceHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/), audience: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", namespace: "opencrane-skill-authoring", workloadUid: "job-uid-1" }) });
		expect(JSON.stringify(bootstrapCreate.mock.calls)).not.toContain(bootstrapReference);
	});
});
