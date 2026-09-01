import { AgentRunState, AgentRunTerminalReason, AgentServiceKind, AgentServiceState, WarmRuntimeReservationState, WorkloadAssignmentState, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { AgentRunTaskNames, type AgentRunTaskInput, type AgentRunWarmRuntimeDeletionCommand, type AgentRunWarmRuntimeReservationCommand } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import type { ExecutionSubject } from "@opencrane/models/agents";

import { PrismaAgentRunWarmRuntimeUnitOfWork } from "../prisma-agent-run-warm-runtime-authority";

/** Names the exact task and Pod used by every deletion test. */
const _INPUT: AgentRunTaskInput = { siloId: "silo-1", runId: "run-1", attempt: 1 };
const _RECEIPT: IWorkflowTaskReceipt = { taskId: "task-1", taskName: AgentRunTaskNames.Execute, idempotencyKey: "agent-run:silo-1:run-1:attempt:1" };
const _COMMAND: AgentRunWarmRuntimeDeletionCommand = { generation: 1, podName: "warm-pod-1", podUid: "pod-1", deploymentUid: "deployment-1", profile: "personal" };

/** Creates the evidence subject needed by the workflow task reader. */
function _ExecutionSubject(): ExecutionSubject
{
	return { schemaVersion: 1, siloId: "silo-1", agentIdentityId: "identity-1", principalId: "principal-1", identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: "silo-1", headRevision: "1", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision", verifiedAt: "2026-09-01T00:00:00.000Z" }, membership: { principalId: "principal-1", siloId: "silo-1", revision: 1, assertionId: "membership", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision", trustedUntil: "2099-01-01T00:00:00.000Z" }, capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision", decidedAt: "2026-09-01T00:00:00.000Z" }, runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" }, computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 }, requester: { siloId: "silo-1", requesterPrincipalId: "requester-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-09-01T00:00:00.000Z" }, admission: { authorizingPrincipalId: "authorizer-1", decisionEvidenceId: "admission-decision", admittedAt: "2026-09-01T00:00:00.000Z" } };
}

/** Builds mutable cancellation authority with a configurable active provider claim count. */
function _Database(initialActiveClaims: number)
{
	let activeClaims = initialActiveClaims;
	let reservationPresent = true;
	let assignmentPresent = true;
	const assignment = { runId: "run-1", attempt: 1, bindingGeneration: 1 };
	const reservation = { runId: "run-1", attempt: 1, generation: 1, podName: "warm-pod-1", podUid: "pod-1", deploymentUid: "deployment-1", genericProfile: "generic", claimedProfile: "personal", state: WarmRuntimeReservationState.DeleteRequested as WarmRuntimeReservationState, deletedAt: null as Date | null };
	const run = { id: "run-1", siloId: "silo-1", attempt: 1, state: AgentRunState.Cancelling as AgentRunState, agentServiceId: "service-1", agentRevisionId: "revision-1", agentIdentityId: "identity-1", principalId: "principal-1", executionSubject: _ExecutionSubject(), inputSnapshotDigest: "sha256:input", conversationId: "conversation-1", parentRunId: null, rootRunId: "run-1", terminalReason: null as AgentRunTerminalReason | null, finishedAt: null as Date | null, service: { id: "service-1", siloId: "silo-1", kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: "revision-1", workloadProfile: "personal-default" }, inputSnapshot: null };
	const task = { runId: "run-1", attempt: 1, siloId: "silo-1", taskId: "task-1", taskKey: _RECEIPT.idempotencyKey, taskName: AgentRunTaskNames.Execute, assignmentExpiresAt: new Date("2099-01-01T00:00:00.000Z"), run };
	const createEvent = vi.fn();
	const cancelApproval = vi.fn(async function _Cancel() { return { count: 1 }; });
	const cancelElicitation = vi.fn(async function _Cancel() { return { count: 1 }; });
	const client = {
		async $transaction(operation: (transaction: unknown) => Promise<unknown>) { return await operation(client); },
		agentRunWorkflowTask: { async findUnique() { return task; } },
		warmRuntimeReservation: {
			async findUnique() { return reservationPresent ? reservation : null; },
			async updateMany() { reservation.state = WarmRuntimeReservationState.Deleted; reservation.deletedAt = new Date(); return { count: 1 }; },
		},
		workloadAssignment: { findUnique: vi.fn(async function _Find() { return assignmentPresent ? assignment : null; }), updateMany: vi.fn(async function _Revoke() { return { count: 1 }; }) },
		runProofKey: { updateMany: vi.fn(async function _Revoke() { return { count: 1 }; }) },
		workloadBootstrap: { updateMany: vi.fn(async function _Revoke() { return { count: 1 }; }) },
		toolInvocation: {
			async findMany() { return []; },
			async count() { return activeClaims; },
		},
		elicitationRequest: { updateMany: cancelElicitation },
		approvalRequest: { findMany: vi.fn().mockResolvedValue([{ id: "approval-1", siloId: "silo-1" }]), updateMany: cancelApproval },
		authorizationGrant: { findMany: vi.fn().mockResolvedValue([]) },
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
	return { prisma: client as unknown as PrismaClient, reservation, run, cancelApproval, cancelElicitation, createEvent, setActiveClaims(value: number) { activeClaims = value; }, setBindingGeneration(value: number) { assignment.bindingGeneration = value; }, setWarmClaimPresent(value: boolean) { reservationPresent = value; assignmentPresent = value; } };
}

/** Supplies fixed server settings that are not used by deletion finalization. */
function _Authority(prisma: PrismaClient): PrismaAgentRunWarmRuntimeUnitOfWork
{
	const issueAttemptModelKey = Object.assign(vi.fn(), { revokeAttemptKey: vi.fn() });
	return new PrismaAgentRunWarmRuntimeUnitOfWork(prisma, { personalRuntimeNamespace: "personal-runtime", managedRuntimeNamespace: "managed-runtime", assignmentTtlMilliseconds: 60_000, issueAttemptModelKey, continuationRecovery: { async prepareReplacementInTransaction() { return null; } } });
}

/** Builds mutable replacement persistence and real rollback behavior for one current generation. */
function _ReplacementDatabase(runState: AgentRunState, continuationAvailable: boolean, assignmentCasCount = 1)
{
	const run = { id: "run-1", siloId: "silo-1", attempt: 1, state: runState, agentServiceId: "service-1", agentRevisionId: "revision-1", agentIdentityId: "identity-1", principalId: "principal-1", executionSubject: _ExecutionSubject(), inputSnapshotDigest: "sha256:input", conversationId: "conversation-1", service: { id: "service-1", siloId: "silo-1", kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: "revision-1", workloadProfile: "personal-default" }, inputSnapshot: null };
	const task = { runId: "run-1", attempt: 1, siloId: "silo-1", taskId: "task-1", taskKey: _RECEIPT.idempotencyKey, taskName: AgentRunTaskNames.Execute, assignmentExpiresAt: new Date("2099-01-01T00:00:00.000Z"), run };
	const assignment = { runId: "run-1", attempt: 1, bindingGeneration: 1, state: WorkloadAssignmentState.Registered as WorkloadAssignmentState, registeredAt: new Date(), revokedAt: null as Date | null };
	const reservation = { runId: "run-1", attempt: 1, generation: 1, podName: "warm-pod-1", podUid: "pod-1", deploymentUid: "deployment-1", genericProfile: "generic", claimedProfile: "personal", state: WarmRuntimeReservationState.Claimed as WarmRuntimeReservationState, deleteRequestedAt: null as Date | null, deletedAt: null as Date | null };
	let proofRevoked = false;
	let bootstrapRevoked = false;
	let streamFence = 7;
	const continuationRecovery = { prepareReplacementInTransaction: vi.fn(async function _Prepare()
	{
		if (!continuationAvailable)
			return null;
		streamFence += 1;
		return true as const;
	}) };
	const client = {
		async $transaction(operation: (transaction: unknown) => Promise<unknown>)
		{
			const snapshot = { runState: run.state, assignment: { ...assignment }, reservation: { ...reservation }, proofRevoked, bootstrapRevoked, streamFence };
			try { return await operation(client); }
			catch (error)
			{
				run.state = snapshot.runState;
				Object.assign(assignment, snapshot.assignment);
				Object.assign(reservation, snapshot.reservation);
				proofRevoked = snapshot.proofRevoked;
				bootstrapRevoked = snapshot.bootstrapRevoked;
				streamFence = snapshot.streamFence;
				throw error;
			}
		},
		agentRunWorkflowTask: { findUnique: vi.fn().mockResolvedValue(task) },
		workloadAssignment: {
			findUnique: vi.fn().mockResolvedValue(assignment),
			updateMany: vi.fn(async function _Update(args: { data: { bindingGeneration?: number; state?: WorkloadAssignmentState; registeredAt?: null; revokedAt?: Date } })
			{
				if (args.data.bindingGeneration !== undefined)
				{
					if (assignmentCasCount !== 1)
						return { count: assignmentCasCount };
					assignment.bindingGeneration = args.data.bindingGeneration;
					assignment.state = args.data.state ?? assignment.state;
					assignment.registeredAt = args.data.registeredAt ?? assignment.registeredAt;
					return { count: 1 };
				}
				assignment.state = args.data.state ?? assignment.state;
				assignment.revokedAt = args.data.revokedAt ?? assignment.revokedAt;
				return { count: 1 };
			}),
		},
		warmRuntimeReservation: {
			findUnique: vi.fn().mockResolvedValue(reservation),
			updateMany: vi.fn(async function _DeleteRequest() { reservation.state = WarmRuntimeReservationState.DeleteRequested; reservation.deleteRequestedAt = new Date(); return { count: 1 }; }),
		},
		runProofKey: { updateMany: vi.fn(async function _Revoke() { proofRevoked = true; return { count: 1 }; }) },
		workloadBootstrap: { updateMany: vi.fn(async function _Revoke() { bootstrapRevoked = true; return { count: 1 }; }) },
		agentRun: { updateMany: vi.fn(async function _Recover(args: { data: { state: AgentRunState } }) { run.state = args.data.state; return { count: 1 }; }) },
	};
	const issueAttemptModelKey = Object.assign(vi.fn(), { revokeAttemptKey: vi.fn() });
	const authority = new PrismaAgentRunWarmRuntimeUnitOfWork(client as unknown as PrismaClient, { personalRuntimeNamespace: "personal-runtime", managedRuntimeNamespace: "managed-runtime", assignmentTtlMilliseconds: 60_000, issueAttemptModelKey, continuationRecovery });
	return { authority, run, assignment, reservation, continuationRecovery, streamFence() { return streamFence; }, proofWasRevoked() { return proofRevoked; }, bootstrapWasRevoked() { return bootstrapRevoked; } };
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
		expect(database.createEvent).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "run.cancelled", runId: "run-1", attempt: 1 }) });

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

	it("does not finalize cancellation when only an older replacement Pod was deleted", async function _HistoricalDeletionCannotFinalize()
	{
		const database = _Database(0);
		database.setBindingGeneration(2);
		const authority = _Authority(database.prisma);

		await expect(authority.recordWarmPodDeleted(_INPUT, _RECEIPT, _COMMAND)).resolves.toBe("bound");
		expect(database.reservation.state).toBe(WarmRuntimeReservationState.Deleted);
		expect(database.run.state).toBe(AgentRunState.Cancelling);
		expect(database.cancelApproval).not.toHaveBeenCalled();
		expect(database.createEvent).not.toHaveBeenCalled();
	});

	it("finalizes pre-reservation cancellation only after proving both warm claim rows absent", async function _FinalizesUnreservedCancellation()
	{
		const database = _Database(0);
		database.setWarmClaimPresent(false);
		const authority = _Authority(database.prisma);

		await expect(authority.finalizeCancellationWithoutWarmReservation(_INPUT, _RECEIPT)).resolves.toBe("bound");
		expect(database.run.state).toBe(AgentRunState.Cancelled);
		expect(database.run.terminalReason).toBe(AgentRunTerminalReason.UserCancelled);
		expect(database.createEvent).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "run.cancelled", runId: "run-1", attempt: 1 }) });

		await expect(authority.finalizeCancellationWithoutWarmReservation(_INPUT, _RECEIPT)).resolves.toBe("idempotent");
		expect(database.createEvent).toHaveBeenCalledTimes(1);
	});

	it("leaves cancellation with the Pod-owning path when a reservation or assignment exists", async function _KeepsReservedCancellation()
	{
		const database = _Database(0);
		const authority = _Authority(database.prisma);

		await expect(authority.finalizeCancellationWithoutWarmReservation(_INPUT, _RECEIPT)).resolves.toBe("reservation_exists");
		expect(database.run.state).toBe(AgentRunState.Cancelling);
		expect(database.createEvent).not.toHaveBeenCalled();
	});
});

describe("PrismaAgentRunWarmRuntimeUnitOfWork replacement", function _Suite()
{
	it("reuses the task expiry when reserving and reloading a replacement generation", async function _ReplacementExpiryIsStable()
	{
		const assignmentExpiresAt = new Date("2098-01-01T00:00:00.000Z");
		const executionSubject = _ExecutionSubject();
		const assignment = { runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", siloId: "silo-1", agentIdentityId: "identity-1", principalId: "principal-1", executionSubject, audience: "opencrane-agent-runtime", serviceAccountName: "warm-runtime", namespace: "personal-runtime", workloadKind: "Deployment", workloadUid: "logical-workload-1", workloadProfile: "personal-default", podUid: "pod-1", bindingGeneration: 2, state: WorkloadAssignmentState.PendingPod, expiresAt: assignmentExpiresAt, createdAt: new Date("2026-08-29T00:00:00.000Z"), registeredAt: null, revokedAt: null };
		const inputSnapshot = { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", agentIdentityId: "identity-1", principalId: "principal-1", executionSubject, conversationId: "conversation-1", digest: "sha256:input", modelRoute: {}, budgetPolicy: {} };
		const service = { id: "service-1", siloId: "silo-1", kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: "revision-1", workloadProfile: "personal-default" };
		const run = { id: "run-1", siloId: "silo-1", attempt: 1, state: AgentRunState.WaitingForInput, agentServiceId: "service-1", agentRevisionId: "revision-1", agentIdentityId: "identity-1", principalId: "principal-1", executionSubject, inputSnapshotDigest: "sha256:input", conversationId: "conversation-1", service, inputSnapshot };
		const task = { runId: "run-1", attempt: 1, siloId: "silo-1", taskId: "task-1", taskKey: _RECEIPT.idempotencyKey, taskName: AgentRunTaskNames.Execute, assignmentExpiresAt, run };
		let reservation: Record<string, unknown> | null = null;
		const client = {
			async $transaction(operation: (transaction: unknown) => Promise<unknown>) { return await operation(client); },
			agentRunWorkflowTask: { findUnique: vi.fn().mockResolvedValue(task) },
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(assignment) },
			warmRuntimeReservation: {
				findUnique: vi.fn(async function _Find() { return reservation; }),
				findFirst: vi.fn().mockResolvedValue(null),
				create: vi.fn(async function _Create(args: { data: Record<string, unknown> }) { reservation = { ...args.data }; return reservation; }),
			},
			workloadBootstrap: { create: vi.fn().mockResolvedValue({}) },
		};
		const authority = _Authority(client as unknown as PrismaClient);
		const command: AgentRunWarmRuntimeReservationCommand = { generation: 2, workloadProfile: "personal-default", deploymentName: "warm-runtime", deploymentUid: "deployment-2", podName: "warm-pod-2", podUid: "pod-2", podResourceVersion: "resource-2", genericProfile: "generic", claimedProfile: "personal-default", serviceAccountName: "warm-runtime" };

		await expect(authority.reserveWarmPod(_INPUT, _RECEIPT, command)).resolves.toBe("bound");
		expect(reservation).toEqual(expect.objectContaining({ generation: 2, idleDeadline: assignmentExpiresAt }));
		await expect(authority.loadForTask(_INPUT, _RECEIPT)).resolves.toEqual(expect.objectContaining({ bindingGeneration: 2, assignmentExpiresAt: assignmentExpiresAt.toISOString() }));
	});

	it("advances a waiting attempt only after its continuation is durable", async function _ReplaceWaiting()
	{
		const database = _ReplacementDatabase(AgentRunState.WaitingForInput, true);

		await expect(database.authority.prepareWarmRuntimeReplacement(_INPUT, _RECEIPT, _COMMAND)).resolves.toBe("replace");
		expect(database.assignment).toEqual(expect.objectContaining({ bindingGeneration: 2, state: WorkloadAssignmentState.PendingPod }));
		expect(database.reservation.state).toBe(WarmRuntimeReservationState.DeleteRequested);
		expect(database.proofWasRevoked()).toBe(true);
		expect(database.bootstrapWasRevoked()).toBe(true);
		expect(database.streamFence()).toBe(8);
		expect(database.continuationRecovery.prepareReplacementInTransaction).toHaveBeenCalledWith(expect.anything(), "run-1", 1);
	});

	it("requires recovery when a waiting attempt has no durable continuation", async function _MissingContinuation()
	{
		const database = _ReplacementDatabase(AgentRunState.WaitingForInput, false);

		await expect(database.authority.prepareWarmRuntimeReplacement(_INPUT, _RECEIPT, _COMMAND)).resolves.toBe("recovery_required");
		expect(database.run.state).toBe(AgentRunState.RecoveryRequired);
		expect(database.assignment.state).toBe(WorkloadAssignmentState.Revoked);
	});

	it("never replays a running attempt after its Pod dies", async function _RunningCannotReplay()
	{
		const database = _ReplacementDatabase(AgentRunState.Running, true);

		await expect(database.authority.prepareWarmRuntimeReplacement(_INPUT, _RECEIPT, _COMMAND)).resolves.toBe("recovery_required");
		expect(database.run.state).toBe(AgentRunState.RecoveryRequired);
		expect(database.continuationRecovery.prepareReplacementInTransaction).not.toHaveBeenCalled();
	});

	it("rolls back every revocation when the generation fence loses", async function _LostGenerationFence()
	{
		const database = _ReplacementDatabase(AgentRunState.WaitingForInput, true, 0);

		await expect(database.authority.prepareWarmRuntimeReplacement(_INPUT, _RECEIPT, _COMMAND)).rejects.toThrow("generation fence");
		expect(database.assignment).toEqual(expect.objectContaining({ bindingGeneration: 1, state: WorkloadAssignmentState.Registered }));
		expect(database.reservation.state).toBe(WarmRuntimeReservationState.Claimed);
		expect(database.proofWasRevoked()).toBe(false);
		expect(database.bootstrapWasRevoked()).toBe(false);
		expect(database.streamFence()).toBe(7);
	});
});
