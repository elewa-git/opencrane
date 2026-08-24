import { describe, expect, it, vi } from "vitest";

import { PrismaMcpbValidationRepository } from "../mcpb-validation/prisma-mcpb-validation-repository";

/** Return one Prisma transaction double with only the validator-workload delegates this suite needs. */
function _Transaction()
{
	return {
		mcpbValidationWorkload: {
			findFirst: vi.fn(),
			findUnique: vi.fn(),
			updateMany: vi.fn(),
		},
	};
}

/** Return one pending validator workload that a controller may lease. */
function _PendingWorkload()
{
	return { id: "workload-1", siloId: "silo-1", validationId: "validation-1", state: "Pending" as const, claimedAt: null, claimExpiresAt: null, deliveryCount: 0, workloadUid: null };
}

/** Return one claimed validator workload whose lease remains valid. */
function _ClaimedWorkload()
{
	return { ..._PendingWorkload(), state: "Claimed" as const, claimedAt: new Date("2099-07-26T05:00:00.000Z"), claimExpiresAt: new Date("2099-07-26T05:00:30.000Z"), deliveryCount: 1 };
}

describe("Prisma MCP bundle validation workload repository", function _McpbValidationWorkloadRepositorySuite()
{
	it("claims one pending workload with a bounded controller lease", async function _ClaimsPendingWorkload()
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2099-07-26T05:00:01.000Z"));
		const transaction = _Transaction();
		transaction.mcpbValidationWorkload.findFirst.mockResolvedValue(_PendingWorkload());
		transaction.mcpbValidationWorkload.updateMany.mockResolvedValue({ count: 1 });

		const claim = await new PrismaMcpbValidationRepository(transaction as never).claimNextWorkload(30_000);

		expect(claim).toEqual({ workloadId: "workload-1", siloId: "silo-1", validationId: "validation-1", claimedAt: "2099-07-26T05:00:01.000Z", deliveryCount: 1, expiresAt: "2099-07-26T05:00:31.000Z" });
		expect(transaction.mcpbValidationWorkload.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ state: "Pending", deliveryCount: 0 }), data: expect.objectContaining({ state: "Claimed", deliveryCount: 1 }) }));
		vi.useRealTimers();
	});

	it("records the Kubernetes Job UID only for the controller lease that still matches", async function _RecordsAssignedJob()
	{
		const transaction = _Transaction();
		transaction.mcpbValidationWorkload.findUnique.mockResolvedValue(_ClaimedWorkload());
		transaction.mcpbValidationWorkload.updateMany.mockResolvedValue({ count: 1 });

		const outcome = await new PrismaMcpbValidationRepository(transaction as never).commitWorkloadAssignment("workload-1", { claimedAt: "2099-07-26T05:00:00.000Z", deliveryCount: 1, workloadUid: "job-uid-1" });

		expect(outcome).toBe("assigned");
		expect(transaction.mcpbValidationWorkload.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ state: "Claimed", deliveryCount: 1, workloadUid: null }), data: { state: "Assigned", workloadUid: "job-uid-1" } }));
	});

	it("does not assign a workload after its controller lease expires", async function _RejectsExpiredLease()
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2099-07-26T05:00:31.000Z"));
		const transaction = _Transaction();
		transaction.mcpbValidationWorkload.findUnique.mockResolvedValue(_ClaimedWorkload());

		const outcome = await new PrismaMcpbValidationRepository(transaction as never).commitWorkloadAssignment("workload-1", { claimedAt: "2099-07-26T05:00:00.000Z", deliveryCount: 1, workloadUid: "job-uid-1" });

		expect(outcome).toBe("conflict");
		expect(transaction.mcpbValidationWorkload.updateMany).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it("does not report an assignment when the database rejects an expired lease during the compare-and-swap", async function _SurfacesDatabaseLeaseRejection()
	{
		const transaction = _Transaction();
		transaction.mcpbValidationWorkload.findUnique.mockResolvedValue(_ClaimedWorkload());
		transaction.mcpbValidationWorkload.updateMany.mockRejectedValue(new Error("MCP bundle validation workload assignment requires a live controller lease"));

		await expect(new PrismaMcpbValidationRepository(transaction as never).commitWorkloadAssignment("workload-1", { claimedAt: "2099-07-26T05:00:00.000Z", deliveryCount: 1, workloadUid: "job-uid-1" })).rejects.toThrow("live controller lease");
	});
});
