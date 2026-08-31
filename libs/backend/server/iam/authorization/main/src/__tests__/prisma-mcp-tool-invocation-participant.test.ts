import { ExternalActionClaimKind, ExternalActionRecoveryMode, ToolInvocationState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { __CreatePrismaMcpToolInvocationParticipantFactory } from "../prisma-mcp-tool-invocation-participant";
import type { McpTaskToolInvocationLifecycleParticipant } from "../mcp-tool-invocation-participant.types";
import { ExternalActionClaimKinds, ToolInvocationStates } from "../tool-invocation-lifecycle.types";
import { ToolInvocationEventTypes, ToolInvocationRunRecoveryEnterResults } from "../tool-invocation.types";

/** Return a complete ToolInvocation persistence row around the state needed by one test. */
function _Row(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown>
{
	return {
		id: "invocation-row-1", siloId: "silo-1", runId: "run-1", attempt: 2, agentServiceId: "service-1", agentRevisionId: "revision-1", subjectId: "user-1",
		runtimeInstanceId: "runtime-1", commandId: "command-1", candidateId: "candidate-1", toolRevisionId: "mcp-tool-revision-1", toolInvocationId: "tool-1",
		arguments: { title: "Approved" }, argumentsDigest: "sha256:approved", effectiveArguments: { title: "Approved" }, effectiveArgumentsDigest: "sha256:approved", requestFingerprint: "sha256:fingerprint", requestIdentity: {}, approvalRequired: false,
		recoveryMode: ExternalActionRecoveryMode.Manual, recoveryKey: null, state: ToolInvocationState.Ready, preparationAttempt: 1,
		retryDeadlineAt: new Date("2026-08-26T10:05:00.000Z"), nextPreparationAttemptAt: new Date("2026-08-26T10:00:00.000Z"), claimAttempt: 0,
		claimKind: null, claimFence: 0, claimExpiresAt: null, recoveryRequiredAt: null, result: null, failureCode: null, revision: 4,
		createdAt: new Date("2026-08-26T10:00:00.000Z"), updatedAt: new Date("2026-08-26T10:00:00.000Z"), completedAt: null, ...overrides,
	};
}

/** Build the transaction participant with runs-owned event fakes. */
function _Participant(transaction: Prisma.TransactionClient, appendLifecycle = vi.fn().mockResolvedValue(true), mcpTasks?: McpTaskToolInvocationLifecycleParticipant)
{
	const factory = __CreatePrismaMcpToolInvocationParticipantFactory({ appendInTransaction: appendLifecycle }, { appendInTransaction: vi.fn().mockResolvedValue(true) }, { enterRecoveryRequiredInTransaction: vi.fn().mockResolvedValue(ToolInvocationRunRecoveryEnterResults.Entered), resumeRunningInTransaction: vi.fn().mockResolvedValue(true) });
	return { participant: factory.__ForTransaction(transaction, mcpTasks), appendLifecycle };
}

describe("Prisma MCP ToolInvocation transaction participant", function _Suite()
{
	it("claims provider dispatch inside the transaction supplied by the MCP authority", async function _ClaimsDispatch()
	{
		const ready = _Row();
		const claimed = _Row({ state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 1, claimAttempt: 1, claimExpiresAt: new Date("2026-08-26T10:00:31.000Z"), revision: 5 });
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce(claimed), updateMany } } as unknown as Prisma.TransactionClient;
		const { participant } = _Participant(transaction);

		await expect(participant.claim("invocation-row-1", new Date("2026-08-26T10:00:01.000Z"), 30_000)).resolves.toEqual({ outcome: "claimed", claim: { invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 1, revision: 5 }, invocation: expect.objectContaining({ state: ToolInvocationStates.Claimed }) });
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ claimKind: ExternalActionClaimKind.Dispatch }) }));
	});

	it("saves an AgentRun result, delivery, and timeline event in that same transaction", async function _CompletesSuccess()
	{
		const claimed = _Row({ state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 1, claimAttempt: 1, claimExpiresAt: new Date("2026-08-26T10:00:31.000Z"), revision: 5 });
		const succeeded = _Row({ state: ToolInvocationState.Succeeded, claimKind: null, claimFence: 1, claimAttempt: 1, claimExpiresAt: null, result: { ok: true }, revision: 6, completedAt: new Date("2026-08-26T10:00:02.000Z") });
		const create = vi.fn().mockResolvedValue({});
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValueOnce(claimed).mockResolvedValueOnce(succeeded).mockResolvedValueOnce(succeeded), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, toolResultDelivery: { create } } as unknown as Prisma.TransactionClient;
		const { participant, appendLifecycle } = _Participant(transaction);
		const claim = { invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 1, revision: 5 } as const;

		await expect(participant.completeSucceeded(claim, { ok: true }, new Date("2026-08-26T10:00:02.000Z"))).resolves.toEqual(expect.objectContaining({ outcome: "completed" }));
		expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ toolInvocationId: "invocation-row-1", payload: { toolInvocationId: "tool-1", outcome: "succeeded", result: { ok: true } } }) });
		expect(appendLifecycle).toHaveBeenCalledWith(transaction, { runId: "run-1", attempt: 2, eventType: ToolInvocationEventTypes.Completed, payload: { toolInvocationId: "tool-1" } });
	});

	it("completes an MCP task without creating an AgentRun result delivery", async function _CompletesTaskSuccess()
	{
		const claimed = _Row({ runId: null, attempt: null, mcpTaskId: "mcp-task-1", state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 1, claimAttempt: 1, claimExpiresAt: new Date("2026-08-26T10:00:31.000Z"), revision: 5 });
		const succeeded = _Row({ runId: null, attempt: null, mcpTaskId: "mcp-task-1", state: ToolInvocationState.Succeeded, claimKind: null, claimFence: 1, claimAttempt: 1, claimExpiresAt: null, result: { ok: true }, revision: 6, completedAt: new Date("2026-08-26T10:00:02.000Z") });
		const create = vi.fn();
		const completeSucceeded = vi.fn().mockResolvedValue(true);
		const mcpTasks = { markClaimed: vi.fn(), completeUnusedBeforeDispatch: vi.fn(), completeSucceeded, completeFailed: vi.fn(), completeAmbiguous: vi.fn() };
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValueOnce(claimed).mockResolvedValueOnce(succeeded).mockResolvedValueOnce(succeeded), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, toolResultDelivery: { create } } as unknown as Prisma.TransactionClient;
		const { participant, appendLifecycle } = _Participant(transaction, vi.fn().mockResolvedValue(true), mcpTasks);
		const claim = { invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 1, revision: 5 } as const;

		await expect(participant.completeSucceeded(claim, { ok: true }, new Date("2026-08-26T10:00:02.000Z"))).resolves.toEqual(expect.objectContaining({ outcome: "completed" }));
		expect(completeSucceeded).toHaveBeenCalledWith(expect.objectContaining({ mcpTaskId: "mcp-task-1" }), { ok: true }, new Date("2026-08-26T10:00:02.000Z"));
		expect(create).not.toHaveBeenCalled();
		expect(appendLifecycle).not.toHaveBeenCalled();
	});

	it("fails an MCP task without creating an AgentRun result delivery", async function _CompletesTaskFailure()
	{
		const claimed = _Row({ runId: null, attempt: null, mcpTaskId: "mcp-task-1", state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 1, claimAttempt: 1, claimExpiresAt: new Date("2026-08-26T10:00:31.000Z"), revision: 5 });
		const failed = _Row({ runId: null, attempt: null, mcpTaskId: "mcp-task-1", state: ToolInvocationState.Failed, claimKind: null, claimFence: 1, claimAttempt: 1, claimExpiresAt: null, failureCode: "provider_rejected", revision: 6, completedAt: new Date("2026-08-26T10:00:02.000Z") });
		const create = vi.fn();
		const completeFailed = vi.fn().mockResolvedValue(true);
		const mcpTasks = { markClaimed: vi.fn(), completeUnusedBeforeDispatch: vi.fn(), completeSucceeded: vi.fn(), completeFailed, completeAmbiguous: vi.fn() };
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValueOnce(claimed).mockResolvedValueOnce(failed).mockResolvedValueOnce(failed), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, toolResultDelivery: { create } } as unknown as Prisma.TransactionClient;
		const { participant, appendLifecycle } = _Participant(transaction, vi.fn().mockResolvedValue(true), mcpTasks);
		const claim = { invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 1, revision: 5 } as const;

		await expect(participant.completeFailed(claim, "provider_rejected", new Date("2026-08-26T10:00:02.000Z"))).resolves.toEqual(expect.objectContaining({ outcome: "completed" }));
		expect(completeFailed).toHaveBeenCalledWith(expect.objectContaining({ mcpTaskId: "mcp-task-1" }), "provider_rejected", new Date("2026-08-26T10:00:02.000Z"));
		expect(create).not.toHaveBeenCalled();
		expect(appendLifecycle).not.toHaveBeenCalled();
	});

	it("closes exact Ready MCP task work without creating an AgentRun delivery", async function _CompletesUnusedTaskWork()
	{
		const ready = _Row({ runId: null, attempt: null, mcpTaskId: "mcp-task-1" });
		const failed = _Row({ runId: null, attempt: null, mcpTaskId: "mcp-task-1", state: ToolInvocationState.Failed, failureCode: "workflow_attempts_exhausted", revision: 5, completedAt: new Date("2026-08-26T10:00:02.000Z") });
		const completeUnusedBeforeDispatch = vi.fn().mockResolvedValue(true);
		const mcpTasks = { markClaimed: vi.fn(), completeUnusedBeforeDispatch, completeSucceeded: vi.fn(), completeFailed: vi.fn(), completeAmbiguous: vi.fn() };
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce(failed), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, toolResultDelivery: { create: vi.fn() } } as unknown as Prisma.TransactionClient;
		const { participant, appendLifecycle } = _Participant(transaction, vi.fn().mockResolvedValue(true), mcpTasks);

		await expect(participant.completeUnusedBeforeDispatch("invocation-row-1", 4, "workflow_attempts_exhausted", new Date("2026-08-26T10:00:02.000Z"))).resolves.toEqual({ changed: true, invocation: expect.objectContaining({ state: ToolInvocationStates.Failed }) });
		expect(completeUnusedBeforeDispatch).toHaveBeenCalledWith(expect.objectContaining({ mcpTaskId: "mcp-task-1", revision: 5 }), "workflow_attempts_exhausted", new Date("2026-08-26T10:00:02.000Z"));
		expect(appendLifecycle).not.toHaveBeenCalled();
	});

	it("moves an ambiguous MCP task through its task projection without an AgentRun event", async function _RecoversTask()
	{
		const claimed = _Row({ runId: null, attempt: null, mcpTaskId: "mcp-task-1", state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 1, claimAttempt: 1, claimExpiresAt: new Date("2026-08-26T10:00:31.000Z"), revision: 5 });
		const recovered = _Row({ runId: null, attempt: null, mcpTaskId: "mcp-task-1", state: ToolInvocationState.RecoveryRequired, claimKind: null, claimFence: 1, claimAttempt: 1, claimExpiresAt: null, recoveryRequiredAt: new Date("2026-08-26T10:00:02.000Z"), revision: 6 });
		const completeAmbiguous = vi.fn().mockResolvedValue(true);
		const mcpTasks = { markClaimed: vi.fn(), completeUnusedBeforeDispatch: vi.fn(), completeSucceeded: vi.fn(), completeFailed: vi.fn(), completeAmbiguous };
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValueOnce(recovered), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } } as unknown as Prisma.TransactionClient;
		const { participant, appendLifecycle } = _Participant(transaction, vi.fn().mockResolvedValue(true), mcpTasks);
		const claim = { invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 1, revision: 5 } as const;

		await expect(participant.completeAmbiguous(claim, new Date("2026-08-26T10:00:02.000Z"))).resolves.toEqual(expect.objectContaining({ mcpTaskId: "mcp-task-1", state: ToolInvocationStates.RecoveryRequired }));
		expect(completeAmbiguous).toHaveBeenCalledWith(expect.objectContaining({ mcpTaskId: "mcp-task-1" }), new Date("2026-08-26T10:00:02.000Z"));
		expect(appendLifecycle).not.toHaveBeenCalled();
	});
});
