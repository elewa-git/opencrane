import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { PrismaSelfRunCancellationRepository } from "../prisma-self-run-cancellation-repository.js";
import type { RunCancellationRepository } from "../run-cancellation.types.js";
import { SelfRunCancellationOutcomes } from "../self-run-cancellation.types.js";

/** Small Prisma and cancellation doubles, used to check that one owner cannot cancel another's run. */
function _dependencies()
{
	const findFirst = vi.fn();
	const requestCancellationAtomically = vi.fn();
	const prisma = { agentRun: { findFirst } } as unknown as PrismaClient;
	const cancellation = { requestCancellationAtomically } as unknown as RunCancellationRepository;
	return { cancellation, findFirst, prisma, requestCancellationAtomically };
}

describe("PrismaSelfRunCancellationRepository", function _suite()
{
	beforeEach(function _reset() { vi.clearAllMocks(); });

	it("hides foreign runs and never invokes cancellation authority", async function _hidesForeignRun()
	{
		const dependencies = _dependencies();
		dependencies.findFirst.mockResolvedValue(null);
		const adapter = new PrismaSelfRunCancellationRepository(dependencies.prisma, dependencies.cancellation);
		await expect(adapter.requestOwned({ runId: "run-1", expectedAttempt: 3, siloId: "silo-1", subjectId: "user-1" })).resolves.toEqual({ outcome: SelfRunCancellationOutcomes.NotFound });
		expect(dependencies.findFirst).toHaveBeenCalledWith({ where: { id: "run-1", siloId: "silo-1", delegatedUserId: "user-1" }, select: { id: true } });
		expect(dependencies.requestCancellationAtomically).not.toHaveBeenCalled();
	});

	it("passes only server-derived owner identity to attempt-fenced cancellation", async function _cancelsOwnedRun()
	{
		const dependencies = _dependencies();
		dependencies.findFirst.mockResolvedValue({ id: "run-1" });
		dependencies.requestCancellationAtomically.mockResolvedValue({ status: "cancelling", runId: "run-1", attempt: 3, cleanupRequired: true });
		const adapter = new PrismaSelfRunCancellationRepository(dependencies.prisma, dependencies.cancellation);
		await expect(adapter.requestOwned({ runId: "run-1", expectedAttempt: 3, siloId: "silo-1", subjectId: "user-1" })).resolves.toEqual({ outcome: SelfRunCancellationOutcomes.Cancelling, runId: "run-1", attempt: 3 });
		expect(dependencies.requestCancellationAtomically).toHaveBeenCalledWith({ runId: "run-1", expectedAttempt: 3, requestedBy: "user-1" });
	});

	it("maps idempotent final cancellation to the same owner-facing success", async function _mapsReplay()
	{
		const dependencies = _dependencies();
		dependencies.findFirst.mockResolvedValue({ id: "run-1" });
		dependencies.requestCancellationAtomically.mockResolvedValue({ status: "idempotent", runId: "run-1", attempt: 3, state: "cancelled" });
		const adapter = new PrismaSelfRunCancellationRepository(dependencies.prisma, dependencies.cancellation);
		await expect(adapter.requestOwned({ runId: "run-1", expectedAttempt: 3, siloId: "silo-1", subjectId: "user-1" })).resolves.toEqual({ outcome: SelfRunCancellationOutcomes.Cancelled, runId: "run-1", attempt: 3 });
	});
});
