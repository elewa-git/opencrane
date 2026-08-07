import { describe, expect, it, vi } from "vitest";

import { __CreateSkillWorkloadBootstrapReference } from "@opencrane/contracts";

import { PrismaSkillWorkloadAssignmentRepository } from "../prisma-skill-workload-assignment-repository.js";

/** Builds a transaction double with the rows required by a successful assignment transition. */
function _Transaction()
{
	const bootstrapCreate = vi.fn().mockResolvedValue({});
	const transaction = {
		skillAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ singleton: 1, now: new Date("2099-07-26T05:00:01.000Z") }) },
		skillWorkload: { findUnique: vi.fn().mockResolvedValue({ id: "workload-1", state: "Pending", kind: "Authoring", skillRevisionId: "revision-1", skillRevision: { state: "Draft" }, claimedAt: new Date("2099-07-26T05:00:00.000Z"), claimExpiresAt: new Date("2099-07-26T05:00:30.000Z"), deliveryCount: 1, workloadUid: null, bootstrap: null }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		skillWorkloadBootstrap: { create: bootstrapCreate },
	};
	return { repository: new PrismaSkillWorkloadAssignmentRepository(transaction as never, 30_000), bootstrapCreate };
}

/** Builds candidate and mutation delegates that return trigger-owned claim timestamps. */
function _ClaimTransaction()
{
	const updateManyAndReturn = vi.fn().mockResolvedValue([{ claimedAt: new Date("2099-07-26T05:00:01.000Z"), claimExpiresAt: new Date("2099-07-26T05:00:31.000Z") }]);
	const transaction = {
		skillWorkloadClaimCandidate: { findFirst: vi.fn().mockResolvedValue({ id: "workload-1", siloId: "silo-1", kind: "Authoring", skillRevisionId: "revision-1", revisionState: "Draft" }) },
		skillWorkload: { findUnique: vi.fn().mockResolvedValue({ id: "workload-1", siloId: "silo-1", state: "Pending", kind: "Authoring", skillRevisionId: "revision-1", claimedAt: null, claimExpiresAt: null, deliveryCount: 0 }), updateManyAndReturn },
	};
	return { repository: new PrismaSkillWorkloadAssignmentRepository(transaction as never, 30_000), updateManyAndReturn };
}

describe("Prisma skill workload assignment repository", function _DescribeAssignmentRepository()
{
	it("returns the database-owned timestamps written by the claim trigger", async function _ClaimsWithTriggerTimestamps()
	{
		const { repository, updateManyAndReturn } = _ClaimTransaction();

		await expect(repository.claimNext()).resolves.toEqual({ workloadId: "workload-1", siloId: "silo-1", kind: "authoring", skillRevisionId: "revision-1", claimedAt: "2099-07-26T05:00:01.000Z", deliveryCount: 1, expiresAt: "2099-07-26T05:00:31.000Z" });
		const mutation = updateManyAndReturn.mock.calls[0]?.[0] as { readonly data?: { readonly claimedAt?: Date; readonly claimExpiresAt?: Date } } | undefined;
		expect(mutation?.data?.claimedAt?.getTime()).toBe(0);
		expect((mutation?.data?.claimExpiresAt?.getTime() ?? 0) - (mutation?.data?.claimedAt?.getTime() ?? 0)).toBe(30_000);
	});

	it("rejects malformed controller assignment generations before durable reads", async function _RejectsMalformedAssignment()
	{
		const repository = new PrismaSkillWorkloadAssignmentRepository({} as never, 30_000);
		await expect(repository.commitAssignment("", { claimedAt: "not-a-time", deliveryCount: 0, workloadUid: "", bootstrapReference: "", namespace: "" })).resolves.toBe("conflict");
	});

	it("persists only the hash of the deterministic bootstrap reference", async function _WritesBootstrapHash()
	{
		const { repository, bootstrapCreate } = _Transaction();
		const bootstrapReference = await __CreateSkillWorkloadBootstrapReference("workload-1");

		expect(await repository.commitAssignment("workload-1", { claimedAt: "2099-07-26T05:00:00.000Z", deliveryCount: 1, workloadUid: "job-uid-1", bootstrapReference, namespace: "tenant-a-authoring" })).toBe("assigned");
		expect(bootstrapCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ skillWorkloadId: "workload-1", referenceHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/), audience: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", namespace: "tenant-a-authoring", workloadUid: "job-uid-1" }) });
		expect(bootstrapCreate.mock.calls[0]?.[0]?.data).not.toHaveProperty("expiresAt");
		expect(JSON.stringify(bootstrapCreate.mock.calls)).not.toContain(bootstrapReference);
	});
});
