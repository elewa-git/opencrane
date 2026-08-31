import { ExternalActionRecoveryMode, ToolInvocationState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ToolInvocationStates } from "../tool-invocation-lifecycle.types";
import { PrismaMcpUnusedToolInvocationRepository } from "../prisma-mcp-unused-tool-invocation-repository";

/** Return a task-owned invocation around the state selected by one test. */
function _Invocation(state: ToolInvocationState, revision: number)
{
	return { id: "invocation-row-1", siloId: "silo-1", runId: null, attempt: null, agentServiceId: null, agentRevisionId: null, mcpTaskId: "mcp-task-1", subjectId: "user-1", runtimeInstanceId: "runtime-1", commandId: "command-1", candidateId: "candidate-1", toolRevisionId: "tool-1", toolInvocationId: "call-1", arguments: {}, argumentsDigest: "sha256:args", effectiveArguments: {}, effectiveArgumentsDigest: "sha256:args", requestFingerprint: "sha256:fingerprint", requestIdentity: {}, approvalRequired: false, recoveryMode: ExternalActionRecoveryMode.Manual, recoveryKey: null, state, preparationAttempt: 0, retryDeadlineAt: new Date("2026-08-28T12:05:00.000Z"), nextPreparationAttemptAt: new Date("2026-08-28T12:00:00.000Z"), claimAttempt: 0, claimKind: null, claimFence: 0, claimExpiresAt: null, recoveryRequiredAt: null, result: null, failureCode: state === ToolInvocationState.Failed ? "workflow_attempts_exhausted" : null, revision, createdAt: new Date("2026-08-28T12:00:00.000Z"), updatedAt: new Date("2026-08-28T12:00:00.000Z"), completedAt: null };
}

describe("Prisma MCP unused ToolInvocation repository", function _Suite()
{
	it("closes Ready task work only under its exact revision", async function _ClosesReadyWork()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(_Invocation(ToolInvocationState.Ready, 4)).mockResolvedValueOnce(_Invocation(ToolInvocationState.Failed, 5)), updateMany } } as unknown as Prisma.TransactionClient;

		await expect(new PrismaMcpUnusedToolInvocationRepository(transaction).complete("invocation-row-1", 4, "workflow_attempts_exhausted", new Date("2026-08-28T12:00:01.000Z"))).resolves.toEqual({ changed: true, invocation: expect.objectContaining({ state: ToolInvocationStates.Failed, revision: 5 }) });

		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "invocation-row-1", mcpTaskId: "mcp-task-1", state: ToolInvocationState.Ready, revision: 4, claimKind: null, claimExpiresAt: null }), data: expect.objectContaining({ state: ToolInvocationState.Failed, failureCode: "workflow_attempts_exhausted" }) }));
	});

	it("returns the winner without writing when the invocation is already terminal", async function _RejectsTerminalWork()
	{
		const updateMany = vi.fn();
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValue(_Invocation(ToolInvocationState.Failed, 5)), updateMany } } as unknown as Prisma.TransactionClient;

		await expect(new PrismaMcpUnusedToolInvocationRepository(transaction).complete("invocation-row-1", 4, "workflow_attempts_exhausted", new Date("2026-08-28T12:00:01.000Z"))).resolves.toEqual({ changed: false, invocation: expect.objectContaining({ state: ToolInvocationStates.Failed }) });

		expect(updateMany).not.toHaveBeenCalled();
	});
});
