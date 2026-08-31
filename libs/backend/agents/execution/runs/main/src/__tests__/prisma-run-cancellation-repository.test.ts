import { AgentRunState, ExternalActionRecoveryMode, Prisma, ToolInvocationState, WorkloadAssignmentState, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaRunCancellationUnitOfWork } from "../prisma-run-cancellation-repository";

/** Create one active run row. */
function _Run(state: AgentRunState = AgentRunState.Queued)
{
	return { id: "run-1", attempt: 1, state, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1" };
}

/** Create the durable task receipt that owns run cleanup and finalization. */
function _Task()
{
	return { taskId: "task-1", runId: "run-1", attempt: 1, siloId: "silo-1" };
}

/** Create the transaction delegates used by cancellation admission. */
function _Transaction(run: ReturnType<typeof _Run>, task: ReturnType<typeof _Task> | null)
{
	return {
		agentRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		agentRunWorkflowTask: { findUnique: vi.fn().mockResolvedValue(task) },
		workloadAssignment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		runProofKey: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		elicitationRequest: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		approvalRequest: { findMany: vi.fn().mockResolvedValue([{ id: "approval-1", siloId: "silo-1" }]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		authorizationGrant: { findMany: vi.fn().mockResolvedValue([]) },
		toolInvocation: {
			findMany: vi.fn().mockResolvedValue([{ id: "invocation-1", toolInvocationId: "tool-call-1", state: ToolInvocationState.Ready, recoveryMode: ExternalActionRecoveryMode.Manual, claimKind: null, preparationAttempt: 0, retryDeadlineAt: new Date("2099-01-01T00:00:00.000Z"), revision: 1 }]),
			updateMany: vi.fn().mockResolvedValue({ count: 1 }),
			count: vi.fn().mockResolvedValue(0),
		},
		toolResultDelivery: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
	};
}

/** Create the transaction-owning cancellation authority and expose its isolation options. */
function _Authority(transaction: ReturnType<typeof _Transaction>)
{
	const options: unknown[] = [];
	const prisma = {
		async $transaction(operation: (client: typeof transaction) => Promise<unknown>, transactionOptions: unknown)
		{
			options.push(transactionOptions);
			return await operation(transaction);
		},
	} as unknown as PrismaClient;
	return { authority: new PrismaRunCancellationUnitOfWork(prisma, function _Now() { return new Date("2026-07-20T00:01:00.000Z"); }), options, prisma };
}

describe("PrismaRunCancellationUnitOfWork", function _Suite()
{
	it("fences the attempt so its workflow can finish cancellation", async function _Cancels()
	{
		const transaction = _Transaction(_Run(AgentRunState.Running), _Task());
		const { authority, options } = _Authority(transaction);

		await expect(authority.requestCancellationAtomically({ runId: "run-1", expectedAttempt: 1 })).resolves.toEqual({ status: "cancelling", runId: "run-1", attempt: 1 });
		expect(options).toEqual([{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }]);
		expect(transaction.agentRun.updateMany).toHaveBeenCalledWith({ where: { id: "run-1", attempt: 1, state: AgentRunState.Running }, data: { state: AgentRunState.Cancelling } });
		expect(transaction.workloadAssignment.updateMany).toHaveBeenCalledWith({ where: { runId: "run-1", attempt: 1, state: { in: [WorkloadAssignmentState.PendingPod, WorkloadAssignmentState.Registered] } }, data: { state: WorkloadAssignmentState.Revoked, revokedAt: new Date("2026-07-20T00:01:00.000Z") } });
		expect(transaction.runProofKey.updateMany).toHaveBeenCalledWith({ where: { runId: "run-1", attempt: 1, revokedAt: null }, data: { revokedAt: new Date("2026-07-20T00:01:00.000Z") } });
		expect(transaction.approvalRequest.updateMany).toHaveBeenCalledOnce();
		expect(transaction.elicitationRequest.updateMany).toHaveBeenCalledOnce();
	});

	it("requires the exact bound workflow task before it changes run authority", async function _RequiresTask()
	{
		const transaction = _Transaction(_Run(), null);
		const { authority } = _Authority(transaction);

		await expect(authority.requestCancellationAtomically({ runId: "run-1", expectedAttempt: 1 })).resolves.toEqual({ status: "conflict", reason: "authority_conflict" });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
	});

	it.each([
		[AgentRunState.Cancelling, "cancelling"],
		[AgentRunState.Cancelled, "cancelled"],
	] as const)("replays %s without another mutation", async function _Replays(state, expectedState)
	{
		const transaction = _Transaction(_Run(state), _Task());
		const { authority } = _Authority(transaction);

		await expect(authority.requestCancellationAtomically({ runId: "run-1", expectedAttempt: 1 })).resolves.toEqual({ status: "idempotent", runId: "run-1", attempt: 1, state: expectedState });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
	});

	it("rejects malformed coordinates before opening a transaction", async function _RejectsMalformed()
	{
		const transaction = _Transaction(_Run(), _Task());
		const { authority, prisma } = _Authority(transaction);
		const start = vi.spyOn(prisma, "$transaction");

		await expect(authority.requestCancellationAtomically({ runId: "", expectedAttempt: 0 })).resolves.toEqual({ status: "conflict", reason: "invalid_request" });
		expect(start).not.toHaveBeenCalled();
	});
});
