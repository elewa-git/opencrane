import { AgentRunState, RuntimeCommandKind, WarmRuntimeReservationState, WorkloadAssignmentState, WorkloadKind, type Prisma } from "@prisma/client";

import type { RuntimeAttemptContinuation, RuntimeContinuationSaveRequest } from "@opencrane/contracts";

import type { RuntimeDispatchAuthorityConfig, RuntimeStreamWorkloadIdentity } from "./prisma-runtime-dispatch-authority.types";
import type { RuntimeContinuationCheckpointRow, RuntimeContinuationCheckpointWrite, RuntimeContinuationPersistenceRepository, RuntimeContinuationSaveAuthority } from "./runtime-continuation.types";

/**
 * Performs continuation reads and compare-and-set writes through a transaction the caller owns.
 * The continuation authority keeps admission decisions above this class; this repository does not
 * accept a runtime or a replacement by itself.
 */
export class PrismaRuntimeContinuationRepository implements RuntimeContinuationPersistenceRepository
{
	/** Caller-owned serializable transaction. */
	private readonly transaction: Prisma.TransactionClient;

	/** Bind all checkpoint persistence to one caller transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Load the current claimed warm-Pod authority for an authenticated save request. */
	async loadSaveAuthority(config: RuntimeDispatchAuthorityConfig, identity: RuntimeStreamWorkloadIdentity, request: RuntimeContinuationSaveRequest): Promise<RuntimeContinuationSaveAuthority | null>
	{
		const assignment = await this.transaction.workloadAssignment.findUnique({ where: { runId_attempt: { runId: request.runId, attempt: request.attempt } } });
		if (assignment === null || assignment.namespace !== identity.namespace || assignment.serviceAccountName !== identity.serviceAccountName || assignment.state !== WorkloadAssignmentState.Registered || assignment.revokedAt !== null || assignment.expiresAt.getTime() <= Date.now() || assignment.workloadKind !== WorkloadKind.Deployment)
			return null;
		if (identity.namespace !== config.personalRuntimeNamespace && identity.namespace !== config.managedRuntimeNamespace)
			return null;
		const reservation = await this.transaction.warmRuntimeReservation.findUnique({ where: { runId_attempt_generation: { runId: request.runId, attempt: request.attempt, generation: assignment.bindingGeneration } } });
		if (reservation === null || reservation.state !== WarmRuntimeReservationState.Claimed || reservation.podUid !== identity.podUid || reservation.namespace !== identity.namespace || reservation.serviceAccountName !== identity.serviceAccountName || reservation.idleDeadline.getTime() <= Date.now())
			return null;
		const stream = await this.transaction.runtimeCommandStream.findUnique({ where: { runId_attempt: { runId: request.runId, attempt: request.attempt } } });
		if (stream === null || stream.runtimeInstanceId === null)
			return null;
		const command = await this.transaction.runtimeDispatchedCommand.findUnique({ where: { commandId: request.commandId } });
		const oldestSaveableSequence = Math.max(1, stream.nextCommandSequence - 2);
		if (command === null || command.runId !== request.runId || command.attempt !== request.attempt || command.kind === RuntimeCommandKind.CancelAttempt || command.sequence < oldestSaveableSequence || command.sequence >= stream.nextCommandSequence || command.fence !== request.fence || command.fence !== stream.fence)
			return null;
		return { inputGeneration: stream.inputGeneration, fence: stream.fence, runtimeInstanceId: stream.runtimeInstanceId, commandSequence: command.sequence };
	}

	/** Confirm that every runtime-supplied pending identifier names durable work on this attempt. */
	async pendingCorrelationsAreDurable(runId: string, attempt: number, continuation: RuntimeAttemptContinuation): Promise<boolean>
	{
		return PrismaRuntimeContinuationRepository.pendingCorrelationsAreDurableInTransaction(this.transaction, runId, attempt, continuation);
	}

	/** Validate pending identifiers inside a replacement transaction owned by run lifecycle. */
	static async pendingCorrelationsAreDurableInTransaction(transaction: Prisma.TransactionClient, runId: string, attempt: number, continuation: RuntimeAttemptContinuation): Promise<boolean>
	{
		const toolIds = continuation.pendingToolCalls.map(function _ToolId(item) { return item.toolInvocationId; });
		const requestKeys = continuation.pendingElicitations.map(function _RequestKey(item) { return item.requestKey; });
		const tools = toolIds.length === 0 ? [] : await transaction.toolInvocation.findMany({ where: { runId, attempt, toolInvocationId: { in: toolIds } }, select: { toolInvocationId: true } });
		const requests = requestKeys.length === 0 ? [] : await transaction.elicitationRequest.findMany({ where: { runId, attempt, requestKey: { in: requestKeys } }, select: { id: true, requestKey: true } });
		if (tools.length !== toolIds.length || requests.length !== requestKeys.length)
			return false;
		const requestByKey = new Map(requests.map(function _Pair(row) { return [row.requestKey, row.id] as const; }));
		return continuation.pendingElicitations.every(function _Matches(item)
		{
			const durableId = requestByKey.get(item.requestKey);
			return durableId !== undefined && (item.requestId === undefined || item.requestId === durableId);
		});
	}

	/** Delete encrypted generations that can no longer be restored by the current stream. */
	deleteOtherGenerations(runId: string, attempt: number, inputGeneration: number)
	{
		return this.transaction.runtimeContinuationCheckpoint.deleteMany({ where: { runId, attempt, inputGeneration: { not: inputGeneration } } });
	}

	/** Load one exact generation's encrypted checkpoint. */
	load(runId: string, attempt: number, inputGeneration: number): Promise<RuntimeContinuationCheckpointRow | null>
	{
		return this.transaction.runtimeContinuationCheckpoint.findUnique({ where: { runId_attempt_inputGeneration: { runId, attempt, inputGeneration } } });
	}

	/** Insert the first checkpoint revision while tolerating a concurrent winner. */
	create(data: RuntimeContinuationCheckpointWrite)
	{
		return this.transaction.runtimeContinuationCheckpoint.createMany({ data: [data], skipDuplicates: true });
	}

	/** Replace one exact prior revision so concurrent writers cannot move the frontier backwards. */
	update(runId: string, attempt: number, inputGeneration: number, expectedRevision: number, data: RuntimeContinuationCheckpointWrite)
	{
		return this.transaction.runtimeContinuationCheckpoint.updateMany({ where: { runId, attempt, inputGeneration, revision: expectedRevision }, data });
	}

	/** Load and validate a waiting attempt's latest checkpoint before replacement. */
	async loadWaitingRecovery(runId: string, attempt: number): Promise<{ readonly checkpoint: RuntimeContinuationCheckpointRow; readonly inputGeneration: number; readonly fence: number } | null>
	{
		return PrismaRuntimeContinuationRepository.loadWaitingRecoveryInTransaction(this.transaction, runId, attempt);
	}

	/** Load recovery state inside the run-lifecycle replacement transaction. */
	static async loadWaitingRecoveryInTransaction(transaction: Prisma.TransactionClient, runId: string, attempt: number): Promise<{ readonly checkpoint: RuntimeContinuationCheckpointRow; readonly inputGeneration: number; readonly fence: number } | null>
	{
		const run = await transaction.agentRun.findUnique({ where: { id: runId }, select: { attempt: true, state: true } });
		if (run === null || run.attempt !== attempt || run.state !== AgentRunState.WaitingForInput)
			return null;
		const stream = await transaction.runtimeCommandStream.findUnique({ where: { runId_attempt: { runId, attempt } } });
		if (stream === null)
			return null;
		const checkpoint = await transaction.runtimeContinuationCheckpoint.findUnique({ where: { runId_attempt_inputGeneration: { runId, attempt, inputGeneration: stream.inputGeneration } } });
		return checkpoint === null || checkpoint.appliedCommandSequence !== stream.nextCommandSequence - 1 ? null : { checkpoint, inputGeneration: stream.inputGeneration, fence: stream.fence };
	}

	/** Advance the exact current stream fence and clear its old process binding. */
	advanceFence(runId: string, attempt: number, inputGeneration: number, expectedFence: number)
	{
		return PrismaRuntimeContinuationRepository.advanceFenceInTransaction(this.transaction, runId, attempt, inputGeneration, expectedFence);
	}

	/** Advance recovery fencing inside the run-lifecycle replacement transaction. */
	static advanceFenceInTransaction(transaction: Prisma.TransactionClient, runId: string, attempt: number, inputGeneration: number, expectedFence: number)
	{
		return transaction.runtimeCommandStream.updateMany({ where: { runId, attempt, inputGeneration, fence: expectedFence }, data: { fence: expectedFence + 1, runtimeInstanceId: null } });
	}
}
