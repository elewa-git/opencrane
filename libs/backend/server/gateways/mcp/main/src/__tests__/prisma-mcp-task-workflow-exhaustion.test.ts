import { ExternalActionClaimKind, McpExecutorCommandState, McpExecutorWorkloadState, McpRuntimeExecutionKind, McpTaskState, Prisma, ToolInvocationState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ToolInvocationStates } from "@opencrane/backend/server/iam/authorization";

import { PrismaMcpTaskWorkflowExhaustionRepository } from "../mcp-tasks/prisma-mcp-task-workflow-exhaustion-repository";
import { McpTaskStates } from "../mcp-tasks/mcp-task.types";
import { PrismaMcpRuntimeUnitOfWork } from "../runtime/prisma-mcp-runtime-authority";

/** Stable workflow coordinates used by every aggregate test. */
const _INPUT = { siloId: "silo-a", mcpTaskId: "mcp-task-1", callDigest: `sha256:${"b".repeat(64)}` };

/** Database time shared by task, invocation, and execution terminal writes. */
const _NOW = new Date("2026-08-28T12:00:00.000Z");

/** Return the smallest complete task aggregate needed by the reconciler. */
function _Task(state: McpTaskState, toolInvocation: Record<string, unknown> | null = null)
{
	return { id: _INPUT.mcpTaskId, siloId: _INPUT.siloId, callDigest: _INPUT.callDigest, state, toolInvocation };
}

/** Return one exact Ready invocation with an optional runtime execution. */
function _ReadyInvocation(execution: Record<string, unknown> | null = null)
{
	return { id: "invocation-1", state: ToolInvocationState.Ready, revision: 7, claimKind: null, claimFence: 0, claimExpiresAt: null, mcpRuntimeExecution: execution };
}

/** Return one assigned runtime execution that cannot have reached provider dispatch. */
function _PendingExecution()
{
	return { id: "execution-1", siloId: _INPUT.siloId, toolInvocationId: "invocation-1", kind: McpRuntimeExecutionKind.Invocation, workloadState: McpExecutorWorkloadState.Assigned, commandState: McpExecutorCommandState.Pending, workloadUid: "job-uid-1", claimedAt: new Date("2026-08-28T11:59:00.000Z"), claimExpiresAt: new Date("2026-08-28T12:01:00.000Z"), deliveryCount: 1, companionClaimFence: null, toolInvocationClaimFence: null, toolInvocationClaimRevision: null };
}

/** Build the mocked transaction and authorization participant around one selected aggregate. */
function _Harness(task: Record<string, unknown>, executionUpdateCount = 1)
{
	const transaction = {
		mcpTask: { findFirst: vi.fn().mockResolvedValue(task), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		mcpRuntimeClock: { findUnique: vi.fn().mockResolvedValue({ singleton: 1, now: _NOW }) },
		mcpRuntimeExecution: { updateMany: vi.fn().mockResolvedValue({ count: executionUpdateCount }) },
	};
	const toolInvocations = {
		completeUnusedBeforeDispatch: vi.fn().mockResolvedValue({ changed: true, invocation: { state: ToolInvocationStates.Failed, failureCode: "workflow_attempts_exhausted" } }),
		completeAmbiguous: vi.fn().mockResolvedValue({ state: ToolInvocationStates.RecoveryRequired }),
	};
	return { transaction, toolInvocations, reconciler: new PrismaMcpTaskWorkflowExhaustionRepository(transaction as never, toolInvocations as never) };
}

describe("Prisma MCP task workflow exhaustion", function _McpTaskWorkflowExhaustionSuite()
{
	it("fails provider-free work that never created an invocation", async function _ClosesBeforeInvocation()
	{
		const harness = _Harness(_Task(McpTaskState.InputRequired));

		await expect(harness.reconciler.record(_INPUT)).resolves.toEqual({ mcpTaskId: _INPUT.mcpTaskId, state: McpTaskStates.Failed });

		expect(harness.transaction.mcpTask.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: _INPUT.mcpTaskId, siloId: _INPUT.siloId, callDigest: _INPUT.callDigest } }));
		expect(harness.transaction.mcpTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: _INPUT.mcpTaskId, siloId: _INPUT.siloId, callDigest: _INPUT.callDigest, state: McpTaskState.InputRequired }), data: { state: McpTaskState.Failed, failureCode: "workflow_attempts_exhausted", completedAt: _NOW } }));
		expect(harness.toolInvocations.completeUnusedBeforeDispatch).not.toHaveBeenCalled();
	});

	it("fails an exact Ready invocation without inventing a runtime execution", async function _ClosesQueuedWithoutExecution()
	{
		const harness = _Harness(_Task(McpTaskState.Queued, _ReadyInvocation()));

		await expect(harness.reconciler.record(_INPUT)).resolves.toEqual({ mcpTaskId: _INPUT.mcpTaskId, state: McpTaskStates.Failed });

		expect(harness.toolInvocations.completeUnusedBeforeDispatch).toHaveBeenCalledWith("invocation-1", 7, "workflow_attempts_exhausted", _NOW);
		expect(harness.transaction.mcpRuntimeExecution.updateMany).not.toHaveBeenCalled();
	});

	it("closes the matching Pending execution with its unused Ready invocation", async function _ClosesQueuedExecution()
	{
		const harness = _Harness(_Task(McpTaskState.Queued, _ReadyInvocation(_PendingExecution())));

		await expect(harness.reconciler.record(_INPUT)).resolves.toEqual({ mcpTaskId: _INPUT.mcpTaskId, state: McpTaskStates.Failed });

		expect(harness.transaction.mcpRuntimeExecution.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "execution-1", commandState: McpExecutorCommandState.Pending, workloadState: McpExecutorWorkloadState.Assigned }), data: expect.objectContaining({ commandState: McpExecutorCommandState.Failed, workloadState: McpExecutorWorkloadState.Closed }) }));
	});

	it("keeps a claimed Pending execution reclaimable until its suspended Job UID is saved", async function _PreservesInFlightAssignment()
	{
		const execution = { ..._PendingExecution(), workloadState: McpExecutorWorkloadState.Pending, workloadUid: null };
		const harness = _Harness(_Task(McpTaskState.Queued, _ReadyInvocation(execution)));

		await expect(harness.reconciler.record(_INPUT)).resolves.toEqual({ mcpTaskId: _INPUT.mcpTaskId, state: McpTaskStates.Failed });

		expect(harness.transaction.mcpRuntimeExecution.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workloadState: McpExecutorWorkloadState.Pending, workloadUid: null, deliveryCount: 1 }), data: expect.objectContaining({ commandState: McpExecutorCommandState.Failed, workloadState: McpExecutorWorkloadState.Pending }) }));
	});

	it("closes an unclaimed Pending execution without creating cleanup work", async function _ClosesUnclaimedExecution()
	{
		const execution = { ..._PendingExecution(), workloadState: McpExecutorWorkloadState.Pending, workloadUid: null, claimedAt: null, claimExpiresAt: null, deliveryCount: 0 };
		const harness = _Harness(_Task(McpTaskState.Queued, _ReadyInvocation(execution)));

		await expect(harness.reconciler.record(_INPUT)).resolves.toEqual({ mcpTaskId: _INPUT.mcpTaskId, state: McpTaskStates.Failed });

		expect(harness.transaction.mcpRuntimeExecution.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ commandState: McpExecutorCommandState.Failed, workloadState: McpExecutorWorkloadState.Closed }) }));
	});

	it("preserves ambiguity after the exact provider dispatch claim", async function _ClosesRunningExecution()
	{
		const execution = { ..._PendingExecution(), workloadState: McpExecutorWorkloadState.Registered, commandState: McpExecutorCommandState.Claimed, companionClaimFence: "companion-fence-1", toolInvocationClaimFence: 3, toolInvocationClaimRevision: 8 };
		const invocation = { ..._ReadyInvocation(execution), state: ToolInvocationState.Claimed, revision: 8, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 3, claimExpiresAt: new Date("2026-08-28T12:01:00.000Z") };
		const harness = _Harness(_Task(McpTaskState.Running, invocation));

		await expect(harness.reconciler.record(_INPUT)).resolves.toEqual({ mcpTaskId: _INPUT.mcpTaskId, state: McpTaskStates.RecoveryRequired });

		expect(harness.toolInvocations.completeAmbiguous).toHaveBeenCalledWith({ invocationId: "invocation-1", kind: "dispatch", fence: 3, revision: 8 }, _NOW);
		expect(harness.transaction.mcpRuntimeExecution.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ companionClaimFence: "companion-fence-1", toolInvocationClaimFence: 3, toolInvocationClaimRevision: 8 }), data: expect.objectContaining({ commandState: McpExecutorCommandState.RecoveryRequired, workloadState: McpExecutorWorkloadState.Closed }) }));
	});

	it("returns an existing terminal result without opening a new transition", async function _ReturnsTerminal()
	{
		const harness = _Harness(_Task(McpTaskState.Completed));

		await expect(harness.reconciler.record(_INPUT)).resolves.toEqual({ mcpTaskId: _INPUT.mcpTaskId, state: McpTaskStates.Completed });

		expect(harness.transaction.mcpRuntimeClock.findUnique).not.toHaveBeenCalled();
		expect(harness.transaction.mcpTask.updateMany).not.toHaveBeenCalled();
	});

	it("rejects a mixed queued aggregate before changing authorization state", async function _RejectsMixedQueuedState()
	{
		const execution = { ..._PendingExecution(), commandState: McpExecutorCommandState.Claimed, companionClaimFence: "unexpected-fence" };
		const harness = _Harness(_Task(McpTaskState.Queued, _ReadyInvocation(execution)));

		await expect(harness.reconciler.record(_INPUT)).resolves.toBeNull();

		expect(harness.toolInvocations.completeUnusedBeforeDispatch).not.toHaveBeenCalled();
		expect(harness.transaction.mcpRuntimeExecution.updateMany).not.toHaveBeenCalled();
	});

	it("rejects a stale running claim fence before changing authorization state", async function _RejectsStaleRunningFence()
	{
		const execution = { ..._PendingExecution(), workloadState: McpExecutorWorkloadState.Registered, commandState: McpExecutorCommandState.Claimed, companionClaimFence: "companion-fence-1", toolInvocationClaimFence: 2, toolInvocationClaimRevision: 8 };
		const invocation = { ..._ReadyInvocation(execution), state: ToolInvocationState.Claimed, revision: 8, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 3, claimExpiresAt: new Date("2026-08-28T12:01:00.000Z") };
		const harness = _Harness(_Task(McpTaskState.Running, invocation));

		await expect(harness.reconciler.record(_INPUT)).resolves.toBeNull();

		expect(harness.toolInvocations.completeAmbiguous).not.toHaveBeenCalled();
	});

	it("reveals nothing when silo, task, or digest coordinates do not select a row", async function _RejectsWrongCoordinates()
	{
		const harness = _Harness(_Task(McpTaskState.Working));
		harness.transaction.mcpTask.findFirst.mockResolvedValueOnce(null);

		await expect(harness.reconciler.record({ ..._INPUT, siloId: "other-silo", callDigest: "wrong-digest" })).resolves.toBeNull();

		expect(harness.transaction.mcpRuntimeClock.findUnique).not.toHaveBeenCalled();
		expect(harness.transaction.mcpTask.updateMany).not.toHaveBeenCalled();
	});

	it("throws after a lost execution fence so the outer transaction rolls back", async function _RollsBackLostFence()
	{
		const harness = _Harness(_Task(McpTaskState.Queued, _ReadyInvocation(_PendingExecution())), 0);

		await expect(harness.reconciler.record(_INPUT)).rejects.toThrow("lost its pre-dispatch runtime fence");
	});

	it("retries the whole aggregate after a serializable collision", async function _RetriesSerializableCollision()
	{
		const transaction = { mcpTask: { findFirst: vi.fn().mockResolvedValue(_Task(McpTaskState.Completed)) } };
		const collision = new Prisma.PrismaClientKnownRequestError("serialization conflict", { code: "P2034", clientVersion: "test" });
		const prisma = { $transaction: vi.fn().mockRejectedValueOnce(collision).mockImplementationOnce(async function _Transaction(operation) { return operation(transaction); }) };
		const toolInvocations = { __ForTransaction: vi.fn().mockReturnValue({}) };
		const options = { siloId: _INPUT.siloId, executorNamespace: "mcp-executors", executorServiceAccountName: "mcp-executor-default", profileName: "mcp-default", controllerClaimLeaseMilliseconds: 30_000, companionClaimLeaseMilliseconds: 60_000, log: { info: vi.fn() } as never };
		const unitOfWork = new PrismaMcpRuntimeUnitOfWork(prisma as never, { toolInvocations: toolInvocations as never, options });

		await expect(unitOfWork.recordWorkflowExhaustion(_INPUT)).resolves.toEqual({ mcpTaskId: _INPUT.mcpTaskId, state: McpTaskStates.Completed });

		expect(prisma.$transaction).toHaveBeenCalledTimes(2);
		expect(toolInvocations.__ForTransaction).toHaveBeenCalledWith(transaction, expect.anything());
	});
});
