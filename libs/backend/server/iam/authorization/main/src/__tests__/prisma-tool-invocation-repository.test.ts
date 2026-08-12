import { AgentRunState, ExternalActionClaimKind, ExternalActionRecoveryMode, ToolInvocationState, type Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ExternalActionClaimKinds, ExternalActionRecoveryModes, ToolInvocationStates } from "../tool-invocation-lifecycle.types.js";
import { PrismaToolInvocationRepository, __AdmitPreparingToolInvocationInTransaction } from "../prisma-tool-invocation-repository.js";
import { PrismaToolInvocationUnitOfWork } from "../prisma-tool-invocation-unit-of-work.js";
import { ToolInvocationEventTypes, ToolInvocationRunRecoveryEnterResults } from "../tool-invocation.types.js";

/** Build one complete persistence row around a focused state override. */
function _row(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown>
{
	return {
		id: "invocation-row-1", siloId: "silo-1", runId: "run-1", attempt: 2, agentServiceId: "service-1", agentRevisionId: "revision-1", subjectId: "user-1",
		runtimeInstanceId: "runtime-1", commandId: "command-1", candidateId: "candidate-1", toolRevisionId: "integration:calendar:create", toolInvocationId: "tool-1",
		arguments: { title: "Proposed" }, argumentsDigest: "sha256:proposed", effectiveArguments: { title: "Proposed" }, effectiveArgumentsDigest: "sha256:proposed", requestFingerprint: "sha256:fingerprint", requestIdentity: {}, approvalRequired: false,
		recoveryMode: ExternalActionRecoveryMode.Manual, recoveryKey: null, state: ToolInvocationState.Preparing, preparationAttempt: 1,
		retryDeadlineAt: new Date("2026-08-11T10:05:00.000Z"), nextPreparationAttemptAt: new Date("2026-08-11T10:00:00.000Z"), claimAttempt: 0,
		claimKind: null, claimFence: 0, claimExpiresAt: null, recoveryRequiredAt: null, result: null, failureCode: null, revision: 0,
		createdAt: new Date("2026-08-11T10:00:00.000Z"), updatedAt: new Date("2026-08-11T10:00:00.000Z"), completedAt: null, ...overrides,
	};
}

/** Fixed provider-free retry policy approved for production. */
function _policy()
{
	return { attemptLimit: 3, retryWindowMilliseconds: 300_000, retryDelayMilliseconds: 1_000 };
}

describe("PrismaToolInvocationRepository", function _suite()
{
	it("admits proposed arguments as effective until an approval replaces them", async function _admits()
	{
		const created = _row({ preparationAttempt: 0 });
		const create = vi.fn().mockResolvedValue(created);
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValue(null), create } } as unknown as Prisma.TransactionClient;
		const intent = { siloId: "silo-1", runId: "run-1", attempt: 2, agentServiceId: "service-1", agentRevisionId: "revision-1", subjectId: "user-1", requestIdentity: { runtimeInstanceId: "runtime-1", commandId: "command-1", candidateId: "candidate-1" }, toolRevisionId: "integration:calendar:create", toolInvocationId: "tool-1", arguments: { title: "Proposed" }, argumentsDigest: "sha256:proposed", requestFingerprint: "sha256:fingerprint", approvalRequired: false, recoveryMode: ExternalActionRecoveryModes.Manual, recoveryKey: null } as const;
		const result = await __AdmitPreparingToolInvocationInTransaction(transaction, intent, new Date("2026-08-11T10:00:00.000Z"), _policy());
		expect(result.outcome).toBe("admitted");
		expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ effectiveArguments: { title: "Proposed" }, effectiveArgumentsDigest: "sha256:proposed", retryDeadlineAt: new Date("2026-08-11T10:05:00.000Z") }) });
	});

	it("selects work only when its stored attempt matches the current running attempt", async function _findRunnable()
	{
		const stale = { ..._row({ id: "stale", attempt: 1 }), run: { attempt: 2 } };
		const current = { ..._row({ id: "current", attempt: 2 }), run: { attempt: 2 } };
		const findMany = vi.fn().mockResolvedValue([stale, current]);
		const repository = new PrismaToolInvocationRepository({ toolInvocation: { findMany } } as unknown as Prisma.TransactionClient);
		await expect(repository.findNextRunnable(new Date("2026-08-11T10:00:01.000Z"))).resolves.toEqual(expect.objectContaining({ id: "current" }));
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: expect.arrayContaining([
			expect.objectContaining({ run: { is: { state: AgentRunState.Running } }, OR: expect.arrayContaining([expect.objectContaining({ state: ToolInvocationState.AwaitingApproval, claimKind: null }), expect.objectContaining({ state: ToolInvocationState.Ready, claimKind: null })]) }),
			expect.objectContaining({ run: { is: { state: AgentRunState.Cancelling } }, state: { in: [ToolInvocationState.Claimed, ToolInvocationState.Reconciling] }, claimKind: { not: null }, claimExpiresAt: { lte: expect.any(Date) } }),
		]) } }));
	});

	it("allows successful first preparation after the retry deadline because only retries expire", async function _latePreparationSuccess()
	{
		const initial = _row({ preparationAttempt: 0, revision: 0 });
		const ready = _row({ state: ToolInvocationState.Ready, preparationAttempt: 1, revision: 1, nextPreparationAttemptAt: new Date("2026-08-11T10:06:00.000Z") });
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(ready), updateMany } } as unknown as Prisma.TransactionClient;

		await expect(new PrismaToolInvocationRepository(transaction).markPrepared("invocation-row-1", 0, new Date("2026-08-11T10:06:00.000Z"))).resolves.toEqual(expect.objectContaining({ state: ToolInvocationStates.Ready, preparationAttempt: 1 }));
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ state: ToolInvocationState.Preparing, revision: 0 }), data: expect.objectContaining({ state: ToolInvocationState.Ready, preparationAttempt: { increment: 1 } }) }));
	});

	it("retries only provider-free preparation before the third attempt", async function _boundedPreparationRetry()
	{
		const initial = _row({ preparationAttempt: 0, revision: 0 });
		const retried = _row({ preparationAttempt: 1, revision: 1, nextPreparationAttemptAt: new Date("2026-08-11T10:00:02.000Z") });
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(retried), updateMany }, toolResultDelivery: { create: vi.fn() } } as unknown as Prisma.TransactionClient;
		const result = await new PrismaToolInvocationRepository(transaction).recordPreparationFailure("invocation-row-1", 0, new Date("2026-08-11T10:00:01.000Z"), _policy(), "preparation_failed");
		expect(result).toEqual({ changed: true, invocation: expect.objectContaining({ state: ToolInvocationStates.Preparing, preparationAttempt: 1 }) });
		expect(transaction.toolResultDelivery.create).not.toHaveBeenCalled();
	});

	it("fails the third provider-free preparation attempt and saves one delivery", async function _exhaustedPreparation()
	{
		const initial = _row({ preparationAttempt: 2, revision: 2 });
		const failed = _row({ state: ToolInvocationState.Failed, preparationAttempt: 3, failureCode: "preparation_failed", revision: 3 });
		const create = vi.fn();
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(failed), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, toolResultDelivery: { create } } as unknown as Prisma.TransactionClient;
		const result = await new PrismaToolInvocationRepository(transaction).recordPreparationFailure("invocation-row-1", 2, new Date("2026-08-11T10:00:01.000Z"), _policy(), "preparation_failed");
		expect(result.invocation).toEqual(expect.objectContaining({ state: ToolInvocationStates.Failed, preparationAttempt: 3 }));
		expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ toolInvocationId: "invocation-row-1", payload: { toolInvocationId: "tool-1", outcome: "failed", failureCode: "preparation_failed" } }) });
	});

	it("persists approved arguments as the only dispatch-effective values", async function _approvedArguments()
	{
		const proposed = _row({ approvalRequired: true, state: ToolInvocationState.AwaitingApproval, revision: 1 });
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValue(proposed), updateMany } } as unknown as Prisma.TransactionClient;
		await expect(new PrismaToolInvocationRepository(transaction).markApproved("invocation-row-1", { title: "Proposed" }, "sha256:proposed", { title: "Approved" }, "sha256:approved")).resolves.toBe(true);
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ effectiveArguments: { title: "Approved" }, effectiveArgumentsDigest: "sha256:approved", state: ToolInvocationState.Ready }) }));
	});

	it("binds terminal completion to exact claim kind, fence, and revision", async function _exactClaim()
	{
		const before = _row({ state: ToolInvocationState.Reconciling, claimKind: ExternalActionClaimKind.Reconcile, claimFence: 4, revision: 6 });
		const winner = _row({ state: ToolInvocationState.Succeeded, claimKind: null, claimFence: 4, result: { ok: true }, revision: 7 });
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(winner).mockResolvedValueOnce(winner), updateMany }, toolResultDelivery: { create: vi.fn() } } as unknown as Prisma.TransactionClient;
		const claim = { invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Reconcile, fence: 4, revision: 6 };
		await new PrismaToolInvocationRepository(transaction).complete(claim, { toolInvocationId: "tool-1", outcome: "succeeded", result: { ok: true } }, new Date("2026-08-11T10:00:01.000Z"));
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ state: ToolInvocationState.Reconciling, claimKind: ExternalActionClaimKind.Reconcile, claimFence: 4, revision: 6, run: { is: { attempt: 2, state: { in: [AgentRunState.Running, AgentRunState.Cancelling] } } } }) }));
	});

	it("does not create a duplicate delivery when a stale claim and revision lose the completion CAS", async function _completionCasLoser()
	{
		const claimed = _row({ state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 3, revision: 5 });
		const winner = _row({ state: ToolInvocationState.Succeeded, claimKind: null, claimFence: 3, revision: 6, result: { ok: true }, completedAt: new Date("2026-08-11T10:00:01.000Z") });
		const updateMany = vi.fn().mockResolvedValue({ count: 0 });
		const create = vi.fn();
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValueOnce(winner), updateMany }, toolResultDelivery: { create } } as unknown as Prisma.TransactionClient;
		const staleClaim = { invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 2, revision: 4 };

		await expect(new PrismaToolInvocationRepository(transaction).complete(staleClaim, { toolInvocationId: "tool-1", outcome: "succeeded", result: { ok: true } }, new Date("2026-08-11T10:00:01.000Z"))).resolves.toEqual({ outcome: "winner", invocation: expect.objectContaining({ state: ToolInvocationStates.Succeeded, revision: 6 }) });
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ claimFence: 2, revision: 4 }) }));
		expect(create).not.toHaveBeenCalled();
	});

	it("never grants a second reconciliation claim while a live lease exists", async function _singleClaim()
	{
		const active = _row({ state: ToolInvocationState.Reconciling, claimKind: ExternalActionClaimKind.Reconcile, claimFence: 2, claimExpiresAt: new Date("2026-08-11T10:01:00.000Z"), revision: 3 });
		const updateMany = vi.fn().mockResolvedValue({ count: 0 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(active).mockResolvedValueOnce(active), updateMany } } as unknown as Prisma.TransactionClient;
		await expect(new PrismaToolInvocationRepository(transaction).claim("invocation-row-1", ExternalActionClaimKinds.Reconcile, new Date("2026-08-11T10:00:01.000Z"), 30_000)).resolves.toEqual({ outcome: "winner", invocation: expect.objectContaining({ claimKind: ExternalActionClaimKinds.Reconcile }) });
		expect(updateMany).not.toHaveBeenCalled();
	});

	it("moves an ambiguous manual dispatch to visible recovery", async function _manualRecovery()
	{
		const claimed = _row({ state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 3, revision: 5 });
		const recovered = _row({ state: ToolInvocationState.RecoveryRequired, claimKind: null, claimFence: 3, revision: 6 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValueOnce(recovered), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } } as unknown as Prisma.TransactionClient;
		const result = await new PrismaToolInvocationRepository(transaction).completeAmbiguous({ invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 3, revision: 5 }, new Date("2026-08-11T10:00:01.000Z"));
		expect(result).toEqual({ changed: true, invocation: expect.objectContaining({ state: ToolInvocationStates.RecoveryRequired }) });
		expect(transaction.toolInvocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ run: { is: { attempt: 2, state: { in: [AgentRunState.Running, AgentRunState.Cancelling] } } } }) }));
	});

	it("releases a proven pre-dispatch failure under the exact claim fence", async function _releaseBeforeDispatch()
	{
		const claimed = _row({ state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 3, revision: 5, preparationAttempt: 1 });
		const ready = _row({ state: ToolInvocationState.Ready, claimKind: null, claimFence: 3, revision: 6, preparationAttempt: 2 });
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValueOnce(ready), updateMany } } as unknown as Prisma.TransactionClient;
		const result = await new PrismaToolInvocationRepository(transaction).releaseClaimBeforeDispatch({ invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 3, revision: 5 }, new Date("2026-08-11T10:00:01.000Z"));
		expect(result.invocation).toEqual(expect.objectContaining({ state: ToolInvocationStates.Ready, preparationAttempt: 2 }));
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ claimKind: ExternalActionClaimKind.Dispatch, claimFence: 3, revision: 5 }) }));
	});

	it("recovers an expired reconciliation lease without starting provider dispatch", async function _expiredReconciliation()
	{
		const active = _row({ recoveryMode: ExternalActionRecoveryMode.Reconciliation, state: ToolInvocationState.Reconciling, claimKind: ExternalActionClaimKind.Reconcile, claimFence: 3, claimExpiresAt: new Date("2026-08-11T10:00:00.000Z"), revision: 5 });
		const available = _row({ recoveryMode: ExternalActionRecoveryMode.Reconciliation, state: ToolInvocationState.Reconciling, claimKind: null, claimFence: 3, claimExpiresAt: null, revision: 6 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(active).mockResolvedValueOnce(available), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } } as unknown as Prisma.TransactionClient;
		const result = await new PrismaToolInvocationRepository(transaction).recoverExpiredClaim("invocation-row-1", new Date("2026-08-11T10:00:01.000Z"));
		expect(result).toEqual({ changed: true, invocation: expect.objectContaining({ state: ToolInvocationStates.Reconciling, claimKind: null }) });
	});
});

describe("PrismaToolInvocationUnitOfWork", function _unitOfWorkSuite()
{
	it("appends a retry-visible preparation failure in the same transaction", async function _eventCoupling()
	{
		const initial = _row({ preparationAttempt: 0, revision: 0 });
		const retried = _row({ preparationAttempt: 1, revision: 1, failureCode: "preparation_failed" });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(retried), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, toolResultDelivery: { create: vi.fn() } };
		const prisma = { $transaction: vi.fn(async function _transaction(operation) { return operation(transaction); }) } as unknown as PrismaClient;
		const appendLifecycle = vi.fn().mockResolvedValue(true);
		const runRecovery = { enterRecoveryRequiredInTransaction: vi.fn().mockResolvedValue(ToolInvocationRunRecoveryEnterResults.Entered), resumeRunningInTransaction: vi.fn().mockResolvedValue(true) };
		const unit = new PrismaToolInvocationUnitOfWork(prisma, { appendInTransaction: appendLifecycle }, { appendInTransaction: vi.fn().mockResolvedValue(true) }, runRecovery);
		await unit.recordPreparationFailure("invocation-row-1", 0, new Date("2026-08-11T10:00:01.000Z"), _policy(), "preparation_failed");
		expect(appendLifecycle).toHaveBeenCalledWith(transaction, { runId: "run-1", attempt: 2, eventType: ToolInvocationEventTypes.Failed, payload: { toolInvocationId: "tool-1", reason: "preparation_failed", retryCount: 1, retryLimit: 3, retrying: true } });
	});

	it("keeps a cancelling run cancelling while committing exact recovery evidence", async function _cancellingRecovery()
	{
		const claimed = _row({ state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 3, revision: 5 });
		const recovery = _row({ state: ToolInvocationState.RecoveryRequired, claimKind: null, claimFence: 3, revision: 6, recoveryRequiredAt: new Date("2026-08-11T10:00:01.000Z") });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValueOnce(recovery), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
		const prisma = { $transaction: vi.fn(async function _transaction(operation) { return operation(transaction); }) } as unknown as PrismaClient;
		const appendRecovery = vi.fn().mockResolvedValue(true);
		const runRecovery = { enterRecoveryRequiredInTransaction: vi.fn().mockResolvedValue(ToolInvocationRunRecoveryEnterResults.Cancelling), resumeRunningInTransaction: vi.fn().mockResolvedValue(true) };
		const unit = new PrismaToolInvocationUnitOfWork(prisma, { appendInTransaction: vi.fn().mockResolvedValue(true) }, { appendInTransaction: appendRecovery }, runRecovery);
		await expect(unit.completeAmbiguous({ invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 3, revision: 5 }, new Date("2026-08-11T10:00:01.000Z"))).resolves.toEqual(expect.objectContaining({ state: ToolInvocationStates.RecoveryRequired }));
		expect(runRecovery.enterRecoveryRequiredInTransaction).toHaveBeenCalledWith(transaction, { runId: "run-1", attempt: 2 });
		expect(runRecovery.resumeRunningInTransaction).not.toHaveBeenCalled();
		expect(appendRecovery).not.toHaveBeenCalled();
	});

	it("fails closed when invocation recovery conflicts with the owning run attempt", async function _recoveryConflict()
	{
		const claimed = _row({ state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 3, revision: 5 });
		const recovery = _row({ state: ToolInvocationState.RecoveryRequired, claimKind: null, claimFence: 3, revision: 6, recoveryRequiredAt: new Date("2026-08-11T10:00:01.000Z") });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValueOnce(recovery), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
		const prisma = { $transaction: vi.fn(async function _transaction(operation) { return operation(transaction); }) } as unknown as PrismaClient;
		const appendRecovery = vi.fn().mockResolvedValue(true);
		const runRecovery = { enterRecoveryRequiredInTransaction: vi.fn().mockResolvedValue(ToolInvocationRunRecoveryEnterResults.Conflict), resumeRunningInTransaction: vi.fn() };
		const unit = new PrismaToolInvocationUnitOfWork(prisma, { appendInTransaction: vi.fn().mockResolvedValue(true) }, { appendInTransaction: appendRecovery }, runRecovery);

		await expect(unit.completeAmbiguous({ invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 3, revision: 5 }, new Date("2026-08-11T10:00:01.000Z"))).rejects.toThrow("tool recovery state conflicts with its owning run attempt");
		expect(appendRecovery).not.toHaveBeenCalled();
	});

	it("commits definite success and clears its dispatch claim while the run is cancelling", async function _successUnderCancellation()
	{
		const claimed = _row({ state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 3, revision: 5 });
		const succeeded = _row({ state: ToolInvocationState.Succeeded, claimKind: null, claimFence: 3, claimExpiresAt: null, revision: 6, result: { ok: true }, completedAt: new Date("2026-08-11T10:00:01.000Z") });
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValueOnce(claimed).mockResolvedValueOnce(succeeded).mockResolvedValueOnce(succeeded), updateMany }, toolResultDelivery: { create: vi.fn().mockResolvedValue({}) } };
		const prisma = { $transaction: vi.fn(async function _transaction(operation) { return operation(transaction); }) } as unknown as PrismaClient;
		const appendLifecycle = vi.fn().mockResolvedValue(true);
		const runRecovery = { enterRecoveryRequiredInTransaction: vi.fn(), resumeRunningInTransaction: vi.fn() };
		const unit = new PrismaToolInvocationUnitOfWork(prisma, { appendInTransaction: appendLifecycle }, { appendInTransaction: vi.fn() }, runRecovery);

		await expect(unit.completeSucceeded({ invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 3, revision: 5 }, { ok: true }, new Date("2026-08-11T10:00:01.000Z"))).resolves.toEqual(expect.objectContaining({ outcome: "completed", invocation: expect.objectContaining({ state: ToolInvocationStates.Succeeded, claimKind: null }) }));
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ run: { is: { attempt: 2, state: { in: [AgentRunState.Running, AgentRunState.Cancelling] } } } }), data: expect.objectContaining({ claimKind: null, claimExpiresAt: null }) }));
		expect(appendLifecycle).toHaveBeenCalledWith(transaction, expect.objectContaining({ eventType: ToolInvocationEventTypes.Completed }));
	});

	it("does not create a delivery or lifecycle event when a stale completion loses the durable CAS", async function _completionCasLoser()
	{
		const claimed = _row({ state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 3, revision: 5 });
		const winner = _row({ state: ToolInvocationState.Succeeded, claimKind: null, claimFence: 3, revision: 6, result: { ok: true }, completedAt: new Date("2026-08-11T10:00:01.000Z") });
		const updateMany = vi.fn().mockResolvedValue({ count: 0 });
		const create = vi.fn();
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValueOnce(claimed).mockResolvedValueOnce(winner), updateMany }, toolResultDelivery: { create } };
		const prisma = { $transaction: vi.fn(async function _transaction(operation) { return operation(transaction); }) } as unknown as PrismaClient;
		const appendLifecycle = vi.fn().mockResolvedValue(true);
		const unit = new PrismaToolInvocationUnitOfWork(prisma, { appendInTransaction: appendLifecycle }, { appendInTransaction: vi.fn() }, { enterRecoveryRequiredInTransaction: vi.fn(), resumeRunningInTransaction: vi.fn() });

		await expect(unit.completeSucceeded({ invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 2, revision: 4 }, { ok: true }, new Date("2026-08-11T10:00:01.000Z"))).resolves.toEqual({ outcome: "winner", invocation: expect.objectContaining({ state: ToolInvocationStates.Succeeded, revision: 6 }) });
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ claimFence: 2, revision: 4 }) }));
		expect(create).not.toHaveBeenCalled();
		expect(appendLifecycle).not.toHaveBeenCalled();
	});

	it("commits definite failure and clears its dispatch claim while the run is cancelling", async function _failureUnderCancellation()
	{
		const claimed = _row({ state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 3, revision: 5 });
		const failed = _row({ state: ToolInvocationState.Failed, claimKind: null, claimFence: 3, claimExpiresAt: null, revision: 6, failureCode: "provider_rejected", completedAt: new Date("2026-08-11T10:00:01.000Z") });
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValueOnce(claimed).mockResolvedValueOnce(failed).mockResolvedValueOnce(failed), updateMany }, toolResultDelivery: { create: vi.fn().mockResolvedValue({}) } };
		const prisma = { $transaction: vi.fn(async function _transaction(operation) { return operation(transaction); }) } as unknown as PrismaClient;
		const appendLifecycle = vi.fn().mockResolvedValue(true);
		const runRecovery = { enterRecoveryRequiredInTransaction: vi.fn(), resumeRunningInTransaction: vi.fn() };
		const unit = new PrismaToolInvocationUnitOfWork(prisma, { appendInTransaction: appendLifecycle }, { appendInTransaction: vi.fn() }, runRecovery);

		await expect(unit.completeFailed({ invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 3, revision: 5 }, "provider_rejected", new Date("2026-08-11T10:00:01.000Z"))).resolves.toEqual(expect.objectContaining({ outcome: "completed", invocation: expect.objectContaining({ state: ToolInvocationStates.Failed, claimKind: null }) }));
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ claimKind: null, claimExpiresAt: null }) }));
		expect(appendLifecycle).toHaveBeenCalledWith(transaction, expect.objectContaining({ eventType: ToolInvocationEventTypes.Failed }));
	});

	it("commits proven pre-dispatch release and clears its claim while the run is cancelling", async function _releaseUnderCancellation()
	{
		const claimed = _row({ state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 3, revision: 5 });
		const ready = _row({ state: ToolInvocationState.Ready, claimKind: null, claimFence: 3, claimExpiresAt: null, revision: 6, preparationAttempt: 2 });
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValueOnce(ready), updateMany }, toolResultDelivery: { create: vi.fn() } };
		const prisma = { $transaction: vi.fn(async function _transaction(operation) { return operation(transaction); }) } as unknown as PrismaClient;
		const unit = new PrismaToolInvocationUnitOfWork(prisma, { appendInTransaction: vi.fn().mockResolvedValue(true) }, { appendInTransaction: vi.fn() }, { enterRecoveryRequiredInTransaction: vi.fn(), resumeRunningInTransaction: vi.fn() });

		await expect(unit.releaseClaimBeforeDispatch({ invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 3, revision: 5 }, new Date("2026-08-11T10:00:01.000Z"))).resolves.toEqual(expect.objectContaining({ state: ToolInvocationStates.Ready, claimKind: null }));
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ run: { is: { attempt: 2, state: { in: [AgentRunState.Running, AgentRunState.Cancelling] } } } }), data: expect.objectContaining({ claimKind: null, claimExpiresAt: null }) }));
	});

	it("commits ambiguity claim release without a recovery event while the run is cancelling", async function _ambiguityUnderCancellation()
	{
		const claimed = _row({ state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 3, revision: 5 });
		const recovery = _row({ state: ToolInvocationState.RecoveryRequired, claimKind: null, claimFence: 3, claimExpiresAt: null, revision: 6, recoveryRequiredAt: new Date("2026-08-11T10:00:01.000Z") });
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValueOnce(recovery), updateMany } };
		const prisma = { $transaction: vi.fn(async function _transaction(operation) { return operation(transaction); }) } as unknown as PrismaClient;
		const appendRecovery = vi.fn().mockResolvedValue(true);
		const runRecovery = { enterRecoveryRequiredInTransaction: vi.fn().mockResolvedValue(ToolInvocationRunRecoveryEnterResults.Cancelling), resumeRunningInTransaction: vi.fn() };
		const unit = new PrismaToolInvocationUnitOfWork(prisma, { appendInTransaction: vi.fn().mockResolvedValue(true) }, { appendInTransaction: appendRecovery }, runRecovery);

		await expect(unit.completeAmbiguous({ invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 3, revision: 5 }, new Date("2026-08-11T10:00:01.000Z"))).resolves.toEqual(expect.objectContaining({ state: ToolInvocationStates.RecoveryRequired, claimKind: null }));
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ claimKind: null, claimExpiresAt: null }) }));
		expect(appendRecovery).not.toHaveBeenCalled();
	});

	it("commits expired-claim recovery without a recovery event while the run is cancelling", async function _expiredClaimUnderCancellation()
	{
		const claimed = _row({ state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 3, claimExpiresAt: new Date("2026-08-11T10:00:00.000Z"), revision: 5 });
		const recovery = _row({ state: ToolInvocationState.RecoveryRequired, claimKind: null, claimFence: 3, claimExpiresAt: null, revision: 6, recoveryRequiredAt: new Date("2026-08-11T10:00:01.000Z") });
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValueOnce(recovery), updateMany } };
		const prisma = { $transaction: vi.fn(async function _transaction(operation) { return operation(transaction); }) } as unknown as PrismaClient;
		const appendRecovery = vi.fn().mockResolvedValue(true);
		const runRecovery = { enterRecoveryRequiredInTransaction: vi.fn().mockResolvedValue(ToolInvocationRunRecoveryEnterResults.Cancelling), resumeRunningInTransaction: vi.fn() };
		const unit = new PrismaToolInvocationUnitOfWork(prisma, { appendInTransaction: vi.fn().mockResolvedValue(true) }, { appendInTransaction: appendRecovery }, runRecovery);

		await expect(unit.recoverExpiredClaim("invocation-row-1", new Date("2026-08-11T10:00:01.000Z"))).resolves.toEqual(expect.objectContaining({ state: ToolInvocationStates.RecoveryRequired, claimKind: null }));
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ run: { is: { attempt: 2, state: { in: [AgentRunState.Running, AgentRunState.Cancelling] } } } }), data: expect.objectContaining({ claimKind: null, claimExpiresAt: null }) }));
		expect(appendRecovery).not.toHaveBeenCalled();
	});
});
