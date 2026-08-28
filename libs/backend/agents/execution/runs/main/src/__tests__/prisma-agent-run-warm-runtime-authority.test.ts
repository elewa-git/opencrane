import { AgentRunState, AgentRunTerminalReason, AgentServiceKind, AgentServiceState, WarmRuntimeReservationState, WorkloadAssignmentState, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { AgentRunTaskNames, type AgentRunTaskInput, type AgentRunWarmRuntimeDeletionCommand } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import { PrismaAgentRunWarmRuntimeUnitOfWork } from "../prisma-agent-run-warm-runtime-authority";

/** Names the exact task and Pod used by every deletion test. */
const _INPUT: AgentRunTaskInput = { siloId: "silo-1", runId: "run-1", attempt: 1 };
const _RECEIPT: IWorkflowTaskReceipt = { taskId: "task-1", taskName: AgentRunTaskNames.Execute, idempotencyKey: "agent-run:silo-1:run-1:attempt:1" };
const _COMMAND: AgentRunWarmRuntimeDeletionCommand = { podName: "warm-pod-1", podUid: "pod-1", deploymentUid: "deployment-1", profile: "personal" };

/** Builds mutable cancellation authority with a configurable active provider claim count. */
function _Database(initialActiveClaims: number)
{
	let activeClaims = initialActiveClaims;
	const reservation = { runId: "run-1", attempt: 1, podName: "warm-pod-1", podUid: "pod-1", deploymentUid: "deployment-1", genericProfile: "generic", claimedProfile: "personal", state: WarmRuntimeReservationState.DeleteRequested as WarmRuntimeReservationState, deletedAt: null as Date | null };
	const run = { id: "run-1", siloId: "silo-1", attempt: 1, state: AgentRunState.Cancelling as AgentRunState, agentServiceId: "service-1", agentRevisionId: "revision-1", inputSnapshotDigest: "sha256:input", effectiveContractDigest: "sha256:contract", conversationId: "conversation-1", parentRunId: null, rootRunId: "run-1", terminalReason: null as AgentRunTerminalReason | null, finishedAt: null as Date | null, service: { id: "service-1", siloId: "silo-1", kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: "revision-1", workloadProfile: "personal-default" }, inputSnapshot: null };
	const task = { runId: "run-1", attempt: 1, siloId: "silo-1", taskId: "task-1", taskKey: _RECEIPT.idempotencyKey, taskName: AgentRunTaskNames.Execute, assignmentExpiresAt: new Date("2099-01-01T00:00:00.000Z"), run };
	const createEvent = vi.fn();
	const cancelApproval = vi.fn(async function _Cancel() { return { count: 1 }; });
	const cancelElicitation = vi.fn(async function _Cancel() { return { count: 1 }; });
	const client = {
		async $transaction(operation: (transaction: unknown) => Promise<unknown>) { return await operation(client); },
		agentRunWorkflowTask: { async findUnique() { return task; } },
		warmRuntimeReservation: {
			async findUnique() { return reservation; },
			async updateMany() { reservation.state = WarmRuntimeReservationState.Deleted; reservation.deletedAt = new Date(); return { count: 1 }; },
		},
		workloadAssignment: { updateMany: vi.fn(async function _Revoke() { return { count: 1 }; }) },
		runProofKey: { updateMany: vi.fn(async function _Revoke() { return { count: 1 }; }) },
		toolInvocation: {
			async findMany() { return []; },
			async count() { return activeClaims; },
		},
		elicitationRequest: { updateMany: cancelElicitation },
		approvalRequest: { updateMany: cancelApproval },
		agentRun: {
			async updateMany(args: { where: { state: AgentRunState }; data: { state: AgentRunState; terminalReason: AgentRunTerminalReason; finishedAt: Date } })
			{
				if (run.state !== args.where.state)
				{
					return { count: 0 };
				}
				run.state = args.data.state;
				run.terminalReason = args.data.terminalReason;
				run.finishedAt = args.data.finishedAt;
				return { count: 1 };
			},
			async findUnique() { return run; },
		},
		conversationRunEvent: { async aggregate() { return { _max: { sequence: 4 } }; }, create: createEvent },
	};
	return { prisma: client as unknown as PrismaClient, reservation, run, cancelApproval, cancelElicitation, createEvent, setActiveClaims(value: number) { activeClaims = value; } };
}

/** Supplies fixed server settings that are not used by deletion finalization. */
function _Authority(prisma: PrismaClient): PrismaAgentRunWarmRuntimeUnitOfWork
{
	const issueAttemptModelKey = Object.assign(vi.fn(), { revokeAttemptKey: vi.fn() });
	return new PrismaAgentRunWarmRuntimeUnitOfWork(prisma, { personalRuntimeNamespace: "personal-runtime", managedRuntimeNamespace: "managed-runtime", assignmentTtlMilliseconds: 60_000, issueAttemptModelKey });
}

describe("PrismaAgentRunWarmRuntimeUnitOfWork deletion", function _Suite()
{
	it("finalizes Cancelling only after the exact Pod deletion and replays idempotently", async function _FinalizesCancellation()
	{
		const database = _Database(0);
		const authority = _Authority(database.prisma);

		await expect(authority.recordWarmPodDeleted(_INPUT, _RECEIPT, _COMMAND)).resolves.toBe("bound");
		expect(database.reservation.state).toBe(WarmRuntimeReservationState.Deleted);
		expect(database.run.state).toBe(AgentRunState.Cancelled);
		expect(database.run.terminalReason).toBe(AgentRunTerminalReason.UserCancelled);
		expect(database.cancelApproval).toHaveBeenCalledTimes(1);
		expect(database.cancelElicitation).toHaveBeenCalledTimes(1);
		expect(database.createEvent).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "run.cancelled", runId: "run-1" }) });

		await expect(authority.recordWarmPodDeleted(_INPUT, _RECEIPT, _COMMAND)).resolves.toBe("idempotent");
		expect(database.createEvent).toHaveBeenCalledTimes(1);
	});

	it("defers terminal cancellation until the active provider output lease settles", async function _DefersActiveClaim()
	{
		const database = _Database(1);
		const authority = _Authority(database.prisma);

		await expect(authority.recordWarmPodDeleted(_INPUT, _RECEIPT, _COMMAND)).resolves.toBe("deferred");
		expect(database.reservation.state).toBe(WarmRuntimeReservationState.Deleted);
		expect(database.run.state).toBe(AgentRunState.Cancelling);
		expect(database.createEvent).not.toHaveBeenCalled();

		database.setActiveClaims(0);
		await expect(authority.recordWarmPodDeleted(_INPUT, _RECEIPT, _COMMAND)).resolves.toBe("bound");
		expect(database.run.state).toBe(AgentRunState.Cancelled);
		await expect(authority.recordWarmPodDeleted(_INPUT, _RECEIPT, _COMMAND)).resolves.toBe("idempotent");
		expect(database.createEvent).toHaveBeenCalledTimes(1);
	});
});
