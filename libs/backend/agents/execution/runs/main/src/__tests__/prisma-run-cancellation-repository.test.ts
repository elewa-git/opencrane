import { AgentRunState, ExternalActionRecoveryMode, RunOutboxEventKind, ToolInvocationState, WorkloadAssignmentState, WorkloadKind, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaRunCancellationRepository } from "../prisma-run-cancellation-repository";

/** Creates one active personal run row. */
function _Run(overrides: Record<string, unknown> = {})
{
	return { id: "run-1", attempt: 1, state: AgentRunState.Queued, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", inputSnapshotDigest: "sha256:snapshot", conversationId: "conversation-1", ...overrides };
}

/** Creates the durable task receipt that may have started the controller Job. */
function _Task(overrides: Record<string, unknown> = {})
{
	return { taskId: "task-1", runId: "run-1", attempt: 1, siloId: "silo-1", ...overrides };
}

/** Creates an exact committed assignment. */
function _Assignment(overrides: Partial<{ readonly workloadKind: WorkloadKind; readonly workloadUid: string }> = {})
{
	return { runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", siloId: "silo-1", namespace: "silo-runtime", workloadProfile: "personal-small", workloadUid: "job-uid-1", workloadKind: WorkloadKind.Job as WorkloadKind, state: WorkloadAssignmentState.Registered, ...overrides };
}

/** Creates a transaction mock for one cancellation request. */
function _CancellationTransaction(run: ReturnType<typeof _Run>, task: ReturnType<typeof _Task>, assignment: ReturnType<typeof _Assignment> | null, activeClaimCount = 0)
{
	return {
		agentService: { findUnique: vi.fn().mockResolvedValue({ id: "service-1", workloadProfile: "personal-small" }) },
		agentRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		workloadAssignment: { findUnique: vi.fn().mockResolvedValue(assignment), updateMany: vi.fn().mockResolvedValue({ count: assignment ? 1 : 0 }) },
		workloadBootstrap: { findUnique: vi.fn().mockResolvedValue(assignment ? { id: "bootstrap-v1_exact" } : null) },
		agentRunWorkflowTask: { findUnique: vi.fn().mockResolvedValue(task) },
		runProofKey: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		elicitationRequest: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
		approvalRequest: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
		toolInvocation: {
			findMany: vi.fn().mockResolvedValue([
				{ id: "invocation-1", toolInvocationId: "tool-call-1", state: ToolInvocationState.Ready, recoveryMode: ExternalActionRecoveryMode.Manual, claimKind: null, preparationAttempt: 0, retryDeadlineAt: new Date("2026-07-20T00:05:00.000Z"), revision: 1 },
				{ id: "invocation-2", toolInvocationId: "tool-call-2", state: ToolInvocationState.Ready, recoveryMode: ExternalActionRecoveryMode.Manual, claimKind: null, preparationAttempt: 0, retryDeadlineAt: new Date("2026-07-20T00:05:00.000Z"), revision: 1 },
			]),
			updateMany: vi.fn().mockResolvedValue({ count: 1 }),
			count: vi.fn().mockResolvedValue(activeClaimCount),
		},
		toolResultDelivery: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
		outboxEvent: {
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
	return new PrismaRunCancellationRepository(prisma, { personalRuntimeNamespace: "silo-runtime", managedRuntimeNamespace: "silo-managed-runtime", claimLeaseMilliseconds: 30_000, orphanObservationMarginMilliseconds: 10_000 }, function _Now() { return new Date("2026-07-20T00:01:00.000Z"); });
}

describe("PrismaRunCancellationRepository", function _DescribeCancellationRepository()
{
	it("leaves an unassigned workflow cancellation for the warm task to finalize", async function _CancelWithoutPhysicalWork()
	{
		const transaction = _CancellationTransaction(_Run(), _Task(), null);
		const repository = _Repository(transaction);

		await expect(repository.requestCancellationAtomically({ runId: "run-1", expectedAttempt: 1, requestedBy: "user-1" })).resolves.toEqual({ status: "cancelling", runId: "run-1", attempt: 1, cleanupRequired: true });
		expect(transaction.agentRun.updateMany).toHaveBeenNthCalledWith(1, { where: expect.objectContaining({ state: AgentRunState.Queued }), data: { state: AgentRunState.Cancelling } });
		expect(transaction.agentRun.updateMany).toHaveBeenCalledTimes(1);
		expect(transaction.approvalRequest.updateMany).toHaveBeenCalledWith({ where: { runId: "run-1", attempt: 1, state: "Pending" }, data: { state: "Cancelled", decidedAt: new Date("2026-07-20T00:01:00.000Z"), decidedBy: null } });
		expect(transaction.elicitationRequest.updateMany).toHaveBeenCalledWith({ where: { runId: "run-1", attempt: 1, state: "Requested" }, data: { state: "Cancelled", resolvedAt: new Date("2026-07-20T00:01:00.000Z"), resolvedBy: null, safeReason: "run_cancelled" } });
		expect(transaction.toolInvocation.updateMany).toHaveBeenCalledTimes(2);
		expect(transaction.toolInvocation.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "invocation-1", runId: "run-1", attempt: 1, claimKind: null }), data: expect.objectContaining({ state: "Failed", failureCode: "run_cancelled", completedAt: new Date("2026-07-20T00:01:00.000Z") }) });
		expect(transaction.toolResultDelivery.createMany).toHaveBeenCalledWith({ data: [
			expect.objectContaining({ toolInvocationId: "invocation-1", state: "Pending", payload: { toolInvocationId: "tool-call-1", outcome: "failed", failureCode: "run_cancelled" } }),
			expect.objectContaining({ toolInvocationId: "invocation-2", state: "Pending", payload: { toolInvocationId: "tool-call-2", outcome: "failed", failureCode: "run_cancelled" } }),
		] });
		expect(transaction.outboxEvent.create).toHaveBeenCalledTimes(1);
		expect(transaction.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: RunOutboxEventKind.RunCancellationRequested }) });
		expect(transaction.conversationRunEvent.create).not.toHaveBeenCalled();
	});

	it("does not let the retained Job cleaner race a warm task before reservation", async function _FenceInFlightCreate()
	{
		const transaction = _CancellationTransaction(_Run(), _Task(), null);
		const repository = _Repository(transaction);

		await expect(repository.requestCancellationAtomically({ runId: "run-1", expectedAttempt: 1, requestedBy: "user-1" })).resolves.toEqual({ status: "cancelling", runId: "run-1", attempt: 1, cleanupRequired: true });
		expect(transaction.outboxEvent.create).toHaveBeenCalledTimes(1);
		expect(transaction.agentRun.updateMany).toHaveBeenCalledTimes(1);
	});

	it("does not send an assigned warm Deployment to the retained Job cleaner", async function _LeavesWarmDeploymentToWorkflow()
	{
		const assignment = _Assignment({ workloadKind: WorkloadKind.Deployment, workloadUid: "pod-uid-1" });
		const transaction = _CancellationTransaction(_Run({ state: AgentRunState.Running }), _Task(), assignment);
		const repository = _Repository(transaction);

		await expect(repository.requestCancellationAtomically({ runId: "run-1", expectedAttempt: 1, requestedBy: "user-1" })).resolves.toEqual({ status: "cancelling", runId: "run-1", attempt: 1, cleanupRequired: true });
		expect(transaction.outboxEvent.create).toHaveBeenCalledTimes(1);
		expect(transaction.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: RunOutboxEventKind.RunCancellationRequested }) });
	});

	it("revokes an assigned workload and issues cleanup with its immutable Kubernetes UID", async function _FenceAssignedWorkload()
	{
		const transaction = _CancellationTransaction(_Run({ state: AgentRunState.Running }), _Task(), _Assignment());
		const repository = _Repository(transaction);

		await expect(repository.requestCancellationAtomically({ runId: "run-1", expectedAttempt: 1, requestedBy: "user-1" })).resolves.toMatchObject({ status: "cancelling", cleanupRequired: true });
		expect(transaction.workloadAssignment.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ state: { in: [WorkloadAssignmentState.PendingPod, WorkloadAssignmentState.Registered] } }), data: { state: WorkloadAssignmentState.Revoked, revokedAt: new Date("2026-07-20T00:01:00.000Z") } });
		expect(transaction.runProofKey.updateMany).toHaveBeenCalledWith({ where: { runId: "run-1", attempt: 1, revokedAt: null }, data: { revokedAt: new Date("2026-07-20T00:01:00.000Z") } });
		expect(transaction.outboxEvent.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ payload: expect.objectContaining({ mode: "assigned", workloadUid: "job-uid-1" }), availableAt: new Date("2026-07-20T00:01:00.000Z") }) });
	});

	it("leaves an active provider claim fenced without a synthetic cancellation result", async function _FenceActiveProviderClaim()
	{
		const transaction = _CancellationTransaction(_Run({ state: AgentRunState.Running }), _Task(), _Assignment(), 1);
		transaction.toolInvocation.findMany.mockResolvedValue([]);
		const repository = _Repository(transaction);

		await expect(repository.requestCancellationAtomically({ runId: "run-1", expectedAttempt: 1, requestedBy: "user-1" })).resolves.toEqual({ status: "cancelling", runId: "run-1", attempt: 1, cleanupRequired: true });
		expect(transaction.toolInvocation.updateMany).not.toHaveBeenCalled();
		expect(transaction.toolResultDelivery.createMany).not.toHaveBeenCalled();
		expect(transaction.agentRun.updateMany).toHaveBeenCalledTimes(1);
	});

	it("lets cancellation fence an exact recovery-required run", async function _CancelRecoveryRequiredRun()
	{
		const transaction = _CancellationTransaction(_Run({ state: AgentRunState.RecoveryRequired }), _Task(), null);
		const repository = _Repository(transaction);

		await expect(repository.requestCancellationAtomically({ runId: "run-1", expectedAttempt: 1, requestedBy: "user-1" })).resolves.toEqual({ status: "cancelling", runId: "run-1", attempt: 1, cleanupRequired: true });
		expect(transaction.agentRun.updateMany).toHaveBeenNthCalledWith(1, { where: expect.objectContaining({ state: AgentRunState.RecoveryRequired }), data: { state: AgentRunState.Cancelling } });
	});

	it("claims exact cleanup and finalises Cancelling only after confirmation", async function _ClaimAndConfirm()
	{
		const workload = { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", namespace: "silo-runtime", workloadProfile: "personal-small", bootstrapReference: "bootstrap-v1_exact", workloadUid: "job-uid-1", mode: "assigned", reason: "cancellation" };
		const run = _Run({ state: AgentRunState.Cancelling });
		const cleanupEvent = { id: "cleanup-1", runId: "run-1", attempt: 1, kind: RunOutboxEventKind.RunWorkloadCleanupRequested, payload: workload, availableAt: new Date("2026-07-20T00:00:00.000Z"), claimedAt: null, publishedAt: null, failedAt: null, deliveryCount: 0 };
		const claimTransaction = { outboxEvent: { findFirst: vi.fn().mockResolvedValue(cleanupEvent), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, agentRun: { findUnique: vi.fn().mockResolvedValue(run) } };
		const claimedEvent = { ...cleanupEvent, claimedAt: new Date("2026-07-20T00:01:00.000Z"), deliveryCount: 1 };
		const confirmTransaction = {
			outboxEvent: { findUnique: vi.fn().mockResolvedValue(claimedEvent), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			agentRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			elicitationRequest: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
			approvalRequest: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
			toolInvocation: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
			toolResultDelivery: { createMany: vi.fn() },
			conversationRunEvent: { aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 5 } }), create: vi.fn().mockResolvedValue({}) },
		};
		const transactions = [claimTransaction, confirmTransaction];
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: never) => Promise<unknown>) { return callback(transactions.shift() as never); }) } as unknown as PrismaClient;
		const times = [new Date("2026-07-20T00:01:00.000Z"), new Date("2026-07-20T00:01:10.000Z")];
		const repository = new PrismaRunCancellationRepository(prisma, { personalRuntimeNamespace: "silo-runtime", managedRuntimeNamespace: "silo-managed-runtime", claimLeaseMilliseconds: 30_000, orphanObservationMarginMilliseconds: 10_000 }, function _Now() { return times.shift() as Date; });

		await expect(repository.claimNextWorkloadCleanupAtomically()).resolves.toMatchObject({ status: "claimed", claim: { lease: { eventId: "cleanup-1", deliveryCount: 1 }, workload } });
		await expect(repository.confirmWorkloadCleanupAtomically("cleanup-1", { claimedAt: "2026-07-20T00:01:00.000Z", deliveryCount: 1, runId: "run-1", attempt: 1, workloadUid: "job-uid-1", outcome: "deleted" })).resolves.toEqual({ status: "confirmed", runId: "run-1", attempt: 1, runFinalized: true });
		expect(confirmTransaction.agentRun.updateMany).toHaveBeenCalledWith({ where: { id: "run-1", attempt: 1, state: AgentRunState.Cancelling }, data: expect.objectContaining({ state: AgentRunState.Cancelled }) });
		expect(confirmTransaction.conversationRunEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversationId: "conversation-1", runId: "run-1", type: "run.cancelled" }) });
	});

	it("defers final cancellation while an acquired provider claim remains active", async function _DeferForActiveProviderClaim()
	{
		const workload = { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", namespace: "silo-runtime", workloadProfile: "personal-small", bootstrapReference: "bootstrap-v1_exact", workloadUid: "job-uid-1", mode: "assigned", reason: "cancellation" };
		const run = _Run({ state: AgentRunState.Cancelling });
		const event = { id: "cleanup-1", runId: "run-1", attempt: 1, kind: RunOutboxEventKind.RunWorkloadCleanupRequested, payload: workload, availableAt: new Date("2026-07-20T00:00:00.000Z"), claimedAt: new Date("2026-07-20T00:01:00.000Z"), publishedAt: null, failedAt: null, deliveryCount: 1 };
		const transaction = {
			outboxEvent: { findUnique: vi.fn().mockResolvedValue(event), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			agentRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn() },
			elicitationRequest: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
			approvalRequest: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
			toolInvocation: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn(), count: vi.fn().mockResolvedValue(1) },
			toolResultDelivery: { createMany: vi.fn() },
			conversationRunEvent: { aggregate: vi.fn(), create: vi.fn() },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunCancellationRepository(prisma, { personalRuntimeNamespace: "silo-runtime", managedRuntimeNamespace: "silo-managed-runtime", claimLeaseMilliseconds: 30_000, orphanObservationMarginMilliseconds: 10_000 }, function _Now() { return new Date("2026-07-20T00:01:10.000Z"); });

		await expect(repository.confirmWorkloadCleanupAtomically("cleanup-1", { claimedAt: "2026-07-20T00:01:00.000Z", deliveryCount: 1, runId: "run-1", attempt: 1, workloadUid: "job-uid-1", outcome: "deleted" })).resolves.toEqual({ status: "confirmed", runId: "run-1", attempt: 1, runFinalized: false });
		expect(transaction.outboxEvent.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "cleanup-1", deliveryCount: 1 }), data: { claimedAt: null, availableAt: new Date("2026-07-20T00:01:20.000Z") } });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
		expect(transaction.conversationRunEvent.create).not.toHaveBeenCalled();

		const settledEvent = { ...event, claimedAt: new Date("2026-07-20T00:01:30.000Z"), deliveryCount: 2 };
		const settledTransaction = {
			...transaction,
			outboxEvent: { findUnique: vi.fn().mockResolvedValue(settledEvent), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			agentRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			toolInvocation: { ...transaction.toolInvocation, count: vi.fn().mockResolvedValue(0) },
			conversationRunEvent: { aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 5 } }), create: vi.fn().mockResolvedValue({}) },
		};
		const settledPrisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof settledTransaction) => Promise<unknown>) { return callback(settledTransaction); }) } as unknown as PrismaClient;
		const settledRepository = new PrismaRunCancellationRepository(settledPrisma, { personalRuntimeNamespace: "silo-runtime", managedRuntimeNamespace: "silo-managed-runtime", claimLeaseMilliseconds: 30_000, orphanObservationMarginMilliseconds: 10_000 }, function _Now() { return new Date("2026-07-20T00:01:40.000Z"); });

		await expect(settledRepository.confirmWorkloadCleanupAtomically("cleanup-1", { claimedAt: "2026-07-20T00:01:30.000Z", deliveryCount: 2, runId: "run-1", attempt: 1, workloadUid: "job-uid-1", outcome: "absent" })).resolves.toEqual({ status: "confirmed", runId: "run-1", attempt: 1, runFinalized: true });
		expect(settledTransaction.agentRun.updateMany).toHaveBeenCalledWith({ where: { id: "run-1", attempt: 1, state: AgentRunState.Cancelling }, data: expect.objectContaining({ state: AgentRunState.Cancelled }) });
	});

	it("persists a first orphan absence and rejects a stale deferral lease", async function _DefersOrphanAbsence()
	{
		const workload = { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", namespace: "silo-runtime", workloadProfile: "personal-small", bootstrapReference: "bootstrap-v1_exact", workloadUid: null, mode: "unassigned_orphan" as const, reason: "cancellation" as const, orphanAbsenceObservedAt: null };
		const event = { id: "cleanup-1", runId: "run-1", attempt: 1, kind: RunOutboxEventKind.RunWorkloadCleanupRequested, payload: workload, availableAt: new Date("2026-07-20T00:00:00.000Z"), claimedAt: new Date("2026-07-20T00:01:00.000Z"), publishedAt: null, failedAt: null, deliveryCount: 1 };
		const transaction = { outboxEvent: { findUnique: vi.fn().mockResolvedValue(event), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: never) => Promise<unknown>) { return callback(transaction as never); }) } as unknown as PrismaClient;
		const repository = new PrismaRunCancellationRepository(prisma, { personalRuntimeNamespace: "silo-runtime", managedRuntimeNamespace: "silo-managed-runtime", claimLeaseMilliseconds: 30_000, orphanObservationMarginMilliseconds: 10_000 }, function _Now() { return new Date("2026-07-20T00:01:05.000Z"); });
		const claim = { lease: { eventId: "cleanup-1", claimedAt: "2026-07-20T00:01:00.000Z", deliveryCount: 1, expiresAt: "2026-07-20T00:01:30.000Z" }, workload };

		await expect(repository.deferUnassignedOrphanAbsenceAtomically("cleanup-1", claim)).resolves.toBe("deferred");
		expect(transaction.outboxEvent.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "cleanup-1", deliveryCount: 1 }), data: expect.objectContaining({ availableAt: new Date("2026-07-20T00:01:15.000Z"), claimedAt: null, payload: expect.objectContaining({ orphanAbsenceObservedAt: "2026-07-20T00:01:05.000Z" }) }) });
		await expect(repository.deferUnassignedOrphanAbsenceAtomically("cleanup-1", { ...claim, lease: { ...claim.lease, deliveryCount: 2 } })).resolves.toBe("conflict");
	});
});
