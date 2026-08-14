import { describe, expect, it, vi } from "vitest";

import { __CreateRuntimeWorkloadCleanupUseCase } from "../runtime-workload-cleanup";
import type { RunCancellationRepository, RunWorkloadCleanupClaim } from "../run-cancellation.types";
import type { RuntimeWorkloadCleanupStore } from "../runtime-workload-cleanup.types";

/** Canonical assigned cleanup claim used by the use-case tests. */
function _Claim(overrides: Partial<RunWorkloadCleanupClaim["workload"]> = {}): RunWorkloadCleanupClaim
{
	return {
		lease: { eventId: "cleanup-1", claimedAt: "2026-07-29T10:00:00.000Z", deliveryCount: 2, expiresAt: "2026-07-29T10:00:30.000Z" },
		workload: {
			runId: "run-1",
			attempt: 3,
			siloId: "silo-1",
			agentServiceId: "service-1",
			agentRevisionId: "revision-1",
			namespace: "runtime-personal",
			workloadProfile: "personal",
			bootstrapReference: "bootstrap-1",
			workloadUid: "job-uid-1",
			mode: "assigned",
			reason: "cancellation",
			orphanAbsenceObservedAt: null,
			...overrides,
		},
	};
}

/** Minimal repository double with all cleanup methods independently observable. */
function _Repository(claim: RunWorkloadCleanupClaim | null): RunCancellationRepository
{
	return {
		requestCancellationAtomically: vi.fn(),
		claimNextWorkloadCleanupAtomically: vi.fn().mockResolvedValue(claim === null ? { status: "none" } : { status: "claimed", claim }),
		confirmWorkloadCleanupAtomically: vi.fn().mockResolvedValue({ status: "confirmed", runId: "run-1", attempt: 3, runFinalized: true }),
		deferUnassignedOrphanAbsenceAtomically: vi.fn().mockResolvedValue("deferred"),
		repairNextExpiredRunAtomically: vi.fn(),
	};
}

/** Minimal physical store double. */
function _Store(result: Awaited<ReturnType<RuntimeWorkloadCleanupStore["deleteExactProjection"]>>): RuntimeWorkloadCleanupStore
{
	return { deleteExactProjection: vi.fn().mockResolvedValue(result) };
}

describe("__CreateRuntimeWorkloadCleanupUseCase", function _suite()
{
	it("does no physical work when no durable claim exists", async function _test()
	{
		const repository = _Repository(null);
		const store = _Store({ status: "absent" });
		const useCase = __CreateRuntimeWorkloadCleanupUseCase({ repository, store });

		await expect(useCase.reconcileNext()).resolves.toEqual({ outcome: "idle" });
		expect(store.deleteExactProjection).not.toHaveBeenCalled();
	});

	it("leaves a UID-preconditioned deletion pending until a later absence", async function _test()
	{
		const claim = _Claim();
		const repository = _Repository(claim);
		const useCase = __CreateRuntimeWorkloadCleanupUseCase({ repository, store: _Store({ status: "deletion_requested", workloadUid: "job-uid-1" }) });

		await expect(useCase.reconcileNext()).resolves.toEqual({ outcome: "deletion_requested", eventId: "cleanup-1", runId: "run-1", attempt: 3, workloadUid: "job-uid-1" });
		expect(repository.confirmWorkloadCleanupAtomically).not.toHaveBeenCalled();
	});

	it("defers the first authoritative absence of an unassigned orphan", async function _test()
	{
		const claim = _Claim({ mode: "unassigned_orphan", workloadUid: null });
		const repository = _Repository(claim);
		const useCase = __CreateRuntimeWorkloadCleanupUseCase({ repository, store: _Store({ status: "absent" }) });

		await expect(useCase.reconcileNext()).resolves.toEqual({ outcome: "orphan_absence_deferred", eventId: "cleanup-1", runId: "run-1", attempt: 3 });
		expect(repository.deferUnassignedOrphanAbsenceAtomically).toHaveBeenCalledWith("cleanup-1", claim);
		expect(repository.confirmWorkloadCleanupAtomically).not.toHaveBeenCalled();
	});

	it("confirms assigned or second-observation absence under the exact claim generation", async function _test()
	{
		const claim = _Claim();
		const repository = _Repository(claim);
		const useCase = __CreateRuntimeWorkloadCleanupUseCase({ repository, store: _Store({ status: "absent" }) });

		await expect(useCase.reconcileNext()).resolves.toEqual({ outcome: "absence_confirmed", eventId: "cleanup-1", confirmation: { status: "confirmed", runId: "run-1", attempt: 3, runFinalized: true } });
		expect(repository.confirmWorkloadCleanupAtomically).toHaveBeenCalledWith("cleanup-1", { claimedAt: "2026-07-29T10:00:00.000Z", deliveryCount: 2, runId: "run-1", attempt: 3, workloadUid: "job-uid-1", outcome: "absent" });
	});

	it("fails closed when the durable absence fence conflicts", async function _test()
	{
		const repository = _Repository(_Claim());
		vi.mocked(repository.confirmWorkloadCleanupAtomically).mockResolvedValue({ status: "conflict", reason: "stale_claim" });
		const useCase = __CreateRuntimeWorkloadCleanupUseCase({ repository, store: _Store({ status: "absent" }) });

		await expect(useCase.reconcileNext()).rejects.toThrow("runtime cleanup absence confirmation conflicted: stale_claim");
	});

	it("shares one active pass and drains it before durable dependencies close", async function _test()
	{
		let releaseClaim!: (value: { readonly status: "none" }) => void;
		const pendingClaim = new Promise<{ readonly status: "none" }>(function _pending(resolve) { releaseClaim = resolve; });
		const repository = _Repository(null);
		vi.mocked(repository.claimNextWorkloadCleanupAtomically).mockReturnValue(pendingClaim);
		const useCase = __CreateRuntimeWorkloadCleanupUseCase({ repository, store: _Store({ status: "absent" }) });

		const first = useCase.reconcileNext();
		const overlapping = useCase.reconcileNext();
		const drain = useCase.drain();
		expect(repository.claimNextWorkloadCleanupAtomically).toHaveBeenCalledTimes(1);
		expect(overlapping).toBe(first);
		let drained = false;
		void drain.then(function _drained() { drained = true; });
		await Promise.resolve();
		expect(drained).toBe(false);

		releaseClaim({ status: "none" });
		await expect(first).resolves.toEqual({ outcome: "idle" });
		await drain;
		expect(drained).toBe(true);
	});
});
