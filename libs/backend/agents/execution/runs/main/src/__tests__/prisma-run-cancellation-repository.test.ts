import { AgentRunState, RunOutboxEventKind, WorkloadAssignmentState, WorkloadKind, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaRunCancellationRepository } from "../prisma-run-cancellation-repository.js";

/** Creates one active personal run row. */
function _Run(overrides: Record<string, unknown> = {})
{
	return { id: "run-1", attempt: 1, state: AgentRunState.Queued, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", inputSnapshotDigest: "sha256:snapshot", threadId: "thread-1", ...overrides };
}

/** Creates the initial attempt event whose claim proves a Kubernetes create may be in flight. */
function _AttemptEvent(overrides: Record<string, unknown> = {})
{
	return { id: "attempt-1", runId: "run-1", attempt: 1, kind: RunOutboxEventKind.RunAttemptRequested, claimedAt: null, publishedAt: null, failedAt: null, deliveryCount: 0, ...overrides };
}

/** Creates an exact committed assignment. */
function _Assignment()
{
	return { runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", siloId: "silo-1", namespace: "silo-runtime", workloadProfile: "personal-small", workloadUid: "job-uid-1", workloadKind: WorkloadKind.Job, state: WorkloadAssignmentState.Registered };
}

/** Returns SQL text from one Prisma tagged query. */
function _SqlText(value: unknown): string
{
	return ((value as { strings?: readonly string[] }).strings ?? []).join(" ");
}

/** Creates a transaction mock for one cancellation request. */
function _CancellationTransaction(run: ReturnType<typeof _Run>, event: ReturnType<typeof _AttemptEvent>, assignment: ReturnType<typeof _Assignment> | null)
{
	const queryRaw = vi.fn(async function _Query(value: unknown)
	{
		return _SqlText(value).includes("clock_timestamp()::timestamp(3)") ? [{ now: new Date("2026-07-20T00:01:00.000Z") }] : [];
	});
	return {
		$queryRaw: queryRaw,
		agentService: { findUnique: vi.fn().mockResolvedValue({ id: "service-1", workloadProfile: "personal-small" }) },
		agentRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		workloadAssignment: { findUnique: vi.fn().mockResolvedValue(assignment), updateMany: vi.fn().mockResolvedValue({ count: assignment ? 1 : 0 }) },
		workloadBootstrap: { findUnique: vi.fn().mockResolvedValue(assignment ? { id: "bootstrap-v1_exact" } : null) },
		runProofKey: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		approvalRequest: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
		outboxEvent: {
			findUnique: vi.fn().mockResolvedValue(event),
			updateMany: vi.fn().mockResolvedValue({ count: 1 }),
			aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 2 } }),
			create: vi.fn().mockResolvedValue({}),
		},
		conversationRunEvent: { aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 3 } }), create: vi.fn().mockResolvedValue({}) },
	};
}

/** Creates the repository under the fixed test lease policy. */
function _Repository(transaction: ReturnType<typeof _CancellationTransaction>): PrismaRunCancellationRepository
{
	const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
	return new PrismaRunCancellationRepository(prisma, { namespace: "silo-runtime", claimLeaseMilliseconds: 30_000, orphanObservationMarginMilliseconds: 10_000 });
}

describe("PrismaRunCancellationRepository", function _DescribeCancellationRepository()
{
	it("finalises immediately when no assignment exists and no controller claim ever left Postgres", async function _CancelWithoutPhysicalWork()
	{
		const transaction = _CancellationTransaction(_Run(), _AttemptEvent(), null);
		const repository = _Repository(transaction);

		await expect(repository.requestCancellationAtomically({ runId: "run-1", expectedAttempt: 1, requestedBy: "user-1" })).resolves.toEqual({ status: "cancelled", runId: "run-1", attempt: 1, cleanupRequired: false });
		expect(transaction.agentRun.updateMany).toHaveBeenNthCalledWith(1, { where: expect.objectContaining({ state: AgentRunState.Queued }), data: { state: AgentRunState.Cancelling } });
		expect(transaction.agentRun.updateMany).toHaveBeenNthCalledWith(2, { where: { id: "run-1", attempt: 1, state: AgentRunState.Cancelling }, data: expect.objectContaining({ state: AgentRunState.Cancelled }) });
		expect(transaction.approvalRequest.updateMany).toHaveBeenCalledWith({ where: { runId: "run-1", attempt: 1, state: "Pending" }, data: { state: "Cancelled", decidedAt: new Date("2026-07-20T00:01:00.000Z"), decidedBy: null, resumeTokenHash: null } });
		expect(transaction.outboxEvent.create).toHaveBeenCalledTimes(1);
		expect(transaction.conversationRunEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "run.cancelled" }) });
	});

	it("delays orphan observation beyond the claimed dispatch lease and request margin", async function _FenceInFlightCreate()
	{
		const event = _AttemptEvent({ claimedAt: new Date("2026-07-20T00:00:50.000Z"), deliveryCount: 1 });
		const transaction = _CancellationTransaction(_Run(), event, null);
		const repository = _Repository(transaction);

		await expect(repository.requestCancellationAtomically({ runId: "run-1", expectedAttempt: 1, requestedBy: "user-1" })).resolves.toEqual({ status: "cancelling", runId: "run-1", attempt: 1, cleanupRequired: true });
		expect(transaction.outboxEvent.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ kind: RunOutboxEventKind.RunWorkloadCleanupRequested, availableAt: new Date("2026-07-20T00:01:30.000Z"), payload: expect.objectContaining({ mode: "unassigned_orphan", workloadUid: null, bootstrapReference: expect.stringMatching(/^bootstrap-v1_[0-9a-f]{64}$/) }) }) });
		expect(transaction.agentRun.updateMany).toHaveBeenCalledTimes(1);
	});

	it("revokes an assigned workload and issues cleanup with its immutable Kubernetes UID", async function _FenceAssignedWorkload()
	{
		const transaction = _CancellationTransaction(_Run({ state: AgentRunState.Running }), _AttemptEvent({ publishedAt: new Date("2026-07-20T00:00:30.000Z") }), _Assignment());
		const repository = _Repository(transaction);

		await expect(repository.requestCancellationAtomically({ runId: "run-1", expectedAttempt: 1, requestedBy: "user-1" })).resolves.toMatchObject({ status: "cancelling", cleanupRequired: true });
		expect(transaction.workloadAssignment.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ state: { in: [WorkloadAssignmentState.PendingPod, WorkloadAssignmentState.Registered] } }), data: { state: WorkloadAssignmentState.Revoked, revokedAt: new Date("2026-07-20T00:01:00.000Z") } });
		expect(transaction.runProofKey.updateMany).toHaveBeenCalledWith({ where: { runId: "run-1", attempt: 1, revokedAt: null }, data: { revokedAt: new Date("2026-07-20T00:01:00.000Z") } });
		expect(transaction.outboxEvent.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ payload: expect.objectContaining({ mode: "assigned", workloadUid: "job-uid-1" }), availableAt: new Date("2026-07-20T00:01:00.000Z") }) });
	});

	it("claims exact cleanup and finalises Cancelling only after confirmation", async function _ClaimAndConfirm()
	{
		const workload = { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", namespace: "silo-runtime", workloadProfile: "personal-small", bootstrapReference: "bootstrap-v1_exact", workloadUid: "job-uid-1", mode: "assigned", reason: "cancellation" };
		const run = _Run({ state: AgentRunState.Cancelling });
		const cleanupEvent = { id: "cleanup-1", runId: "run-1", attempt: 1, kind: RunOutboxEventKind.RunWorkloadCleanupRequested, payload: workload, availableAt: new Date("2026-07-20T00:00:00.000Z"), claimedAt: null, publishedAt: null, failedAt: null, deliveryCount: 0 };
		const claimQuery = vi.fn().mockResolvedValueOnce([{ eventId: "cleanup-1", runId: "run-1", agentServiceId: "service-1" }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ now: new Date("2026-07-20T00:01:00.000Z") }]);
		const claimTransaction = { $queryRaw: claimQuery, outboxEvent: { findUnique: vi.fn().mockResolvedValue(cleanupEvent), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, agentRun: { findUnique: vi.fn().mockResolvedValue(run) } };
		const claimedEvent = { ...cleanupEvent, claimedAt: new Date("2026-07-20T00:01:00.000Z"), deliveryCount: 1 };
		const confirmQuery = vi.fn(async function _Query(value: unknown) { return _SqlText(value).includes("clock_timestamp()::timestamp(3)") ? [{ now: new Date("2026-07-20T00:01:10.000Z") }] : []; });
		const confirmTransaction = { $queryRaw: confirmQuery, outboxEvent: { findUnique: vi.fn().mockResolvedValue(claimedEvent), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, agentRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, conversationRunEvent: { aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 5 } }), create: vi.fn().mockResolvedValue({}) } };
		const transactions = [claimTransaction, confirmTransaction];
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: never) => Promise<unknown>) { return callback(transactions.shift() as never); }) } as unknown as PrismaClient;
		const repository = new PrismaRunCancellationRepository(prisma, { namespace: "silo-runtime", claimLeaseMilliseconds: 30_000, orphanObservationMarginMilliseconds: 10_000 });

		await expect(repository.claimNextWorkloadCleanupAtomically()).resolves.toMatchObject({ status: "claimed", claim: { lease: { eventId: "cleanup-1", deliveryCount: 1 }, workload } });
		await expect(repository.confirmWorkloadCleanupAtomically("cleanup-1", { claimedAt: "2026-07-20T00:01:00.000Z", deliveryCount: 1, runId: "run-1", attempt: 1, workloadUid: "job-uid-1", outcome: "deleted" })).resolves.toEqual({ status: "confirmed", runId: "run-1", attempt: 1, runFinalized: true });
		expect(confirmTransaction.agentRun.updateMany).toHaveBeenCalledWith({ where: { id: "run-1", attempt: 1, state: AgentRunState.Cancelling }, data: expect.objectContaining({ state: AgentRunState.Cancelled }) });
	});
});
