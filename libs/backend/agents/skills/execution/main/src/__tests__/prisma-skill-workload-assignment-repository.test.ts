import { describe, expect, it, vi } from "vitest";

import { __CreateSkillWorkloadBootstrapReference } from "@opencrane/contracts";

import { PrismaSkillWorkloadAssignmentRepository } from "../prisma-skill-workload-assignment-repository.js";

/** Builds a transaction double with the rows required by a successful assignment transition. */
function _Transaction()
{
	const bootstrapCreate = vi.fn().mockResolvedValue({});
	const transaction = {
		$queryRaw: vi.fn().mockResolvedValueOnce([{ skillRevisionId: "revision-1" }]).mockResolvedValueOnce([{ state: "Draft" }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ now: new Date("2026-07-26T05:00:01.000Z") }]),
		skillWorkload: { findUnique: vi.fn().mockResolvedValue({ id: "workload-1", state: "Pending", kind: "Authoring", claimedAt: new Date("2026-07-26T05:00:00.000Z"), deliveryCount: 1, workloadUid: null }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		skillWorkloadBootstrap: { create: bootstrapCreate },
	};
	return { repository: new PrismaSkillWorkloadAssignmentRepository(transaction as never, 30_000), bootstrapCreate };
}

describe("Prisma skill workload assignment repository", function _DescribeAssignmentRepository()
{
	it("rejects malformed controller assignment generations before durable reads", async function _RejectsMalformedAssignment()
	{
		const repository = new PrismaSkillWorkloadAssignmentRepository({} as never, 30_000);
		await expect(repository.commitAssignment("", { claimedAt: "not-a-time", deliveryCount: 0, workloadUid: "", bootstrapReference: "", namespace: "" })).resolves.toBe("conflict");
	});

	it("persists only the hash of the deterministic bootstrap reference", async function _WritesBootstrapHash()
	{
		const { repository, bootstrapCreate } = _Transaction();
		const bootstrapReference = await __CreateSkillWorkloadBootstrapReference("workload-1");

		expect(await repository.commitAssignment("workload-1", { claimedAt: "2026-07-26T05:00:00.000Z", deliveryCount: 1, workloadUid: "job-uid-1", bootstrapReference, namespace: "tenant-a-authoring" })).toBe("assigned");
		expect(bootstrapCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ skillWorkloadId: "workload-1", referenceHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/), audience: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", namespace: "tenant-a-authoring", workloadUid: "job-uid-1" }) });
		expect(JSON.stringify(bootstrapCreate.mock.calls)).not.toContain(bootstrapReference);
	});
});
