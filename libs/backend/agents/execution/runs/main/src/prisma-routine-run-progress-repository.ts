import { AgentRunCancellationDecision, AgentRunState as PrismaAgentRunState, AgentRunTerminalReason as PrismaAgentRunTerminalReason, AgentRunTrigger, Prisma, type AgentRoutineFiring, type AgentRun, type PrismaClient } from "@prisma/client";

import { ___ExecutionSubjectSchema, ___RunInputOriginSchema } from "@opencrane/contracts";
import { AgentRunStates, AgentRunTerminalReasons, AgentRunTriggers } from "@opencrane/models/agents";
import type { AgentRunState as ModelAgentRunState, AgentRunTerminalReason as ModelAgentRunTerminalReason } from "@opencrane/models/agents";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import { _RunInputSnapshot } from "./prisma-run-admission-unit-of-work";
import { RoutineRunProgressCancellationDecisions, type RoutineRunProgressCancellation, type RoutineRunProgressFacts, type RoutineRunProgressFactsRepository } from "./routine-run-progress.types";
import { __DigestRunInputSnapshot } from "./run-input-snapshot-digest";

/** Reads one admitted routine run and its historical continuation evidence. */
export class PrismaRoutineRunProgressFactsRepository implements RoutineRunProgressFactsRepository
{
	/** Transaction shared by every historical row read. */
	public constructor(private readonly transaction: Prisma.TransactionClient) {}

	/** Read one exact attempt; ordinary interactive runs return null and malformed routine links fail closed. */
	public async read(runId: string, attempt: number): Promise<RoutineRunProgressFacts | null>
	{
		if (!Number.isSafeInteger(attempt) || attempt < 1)
			throw new Error("Routine run progress requires a positive attempt");
		const run = await this.transaction.agentRun.findUnique({ where: { id_attempt: { id: runId, attempt } } });
		if (run === null)
			throw new Error("Routine run progress requires the exact admitted attempt");
		if (run.trigger === AgentRunTrigger.Interactive)
		{
			if (run.routineFiringId !== null || run.routineId !== null || run.routineRevision !== null || run.routineScheduledSlot !== null)
				throw new Error("Routine run progress found partial routine linkage");
			return null;
		}
		if (run.trigger !== AgentRunTrigger.Scheduled && run.trigger !== AgentRunTrigger.Manual || run.routineFiringId === null || run.routineId === null || run.routineRevision === null)
			throw new Error("Routine run progress requires complete routine linkage");
		const firing = await this.transaction.agentRoutineFiring.findUnique({ where: { id: run.routineFiringId } });
		if (!_MatchesFiring(firing, run))
			throw new Error("Routine run progress requires its reciprocal routine firing");
		if (run.workflowTaskId === null || run.workflowTaskName === null || run.workflowTaskKey === null)
			throw new Error("Routine run progress requires the original workflow receipt");
		const snapshotRow = await this.transaction.runInputSnapshot.findUnique({ where: { runId_attempt_digest: { runId: run.id, attempt: run.attempt, digest: run.inputSnapshotDigest } } });
		if (snapshotRow === null)
			throw new Error("Routine run progress requires its saved input snapshot");
		const snapshot = _RunInputSnapshot(snapshotRow);
		const subject = ___ExecutionSubjectSchema.safeParse(snapshot.executionSubject);
		if (!subject.success || snapshot.runId !== run.id || snapshot.attempt !== run.attempt || snapshot.digest !== run.inputSnapshotDigest || snapshot.siloId !== run.siloId || snapshot.agentServiceId !== run.agentServiceId || snapshot.agentRevisionId !== run.agentRevisionId || subject.data.agentIdentityId !== run.agentIdentityId || subject.data.principalId !== run.principalId || __DigestRunInputSnapshot(_WithoutDigest(snapshot)) !== snapshot.digest)
			throw new Error("Routine run progress found invalid saved routine snapshot");
		if (!_MatchesOrigin(snapshot.origin, run, firing))
			throw new Error("Routine run progress found mismatched routine snapshot origin");
		if (subject.data.runScope.runId !== run.id || subject.data.runScope.attempt !== run.attempt || subject.data.siloId !== run.siloId || subject.data.requester.requesterPrincipalId !== firing.requesterPrincipalId)
			throw new Error("Routine run progress found mismatched execution subject");
		return { runId: run.id, siloId: run.siloId, attempt: run.attempt, state: _State(run.state), finishedAt: run.finishedAt?.toISOString() ?? null, terminalReason: _TerminalReason(run.terminalReason), trigger: run.trigger === AgentRunTrigger.Scheduled ? "scheduled" : "manual", agentServiceId: run.agentServiceId, agentRevisionId: run.agentRevisionId, agentIdentityId: run.agentIdentityId, principalId: run.principalId, conversationId: run.conversationId, requestIdempotencyKey: run.requestIdempotencyKey, inputSnapshotDigest: run.inputSnapshotDigest, routine: { routineId: run.routineId, routineRevision: run.routineRevision, firingId: run.routineFiringId, scheduledSlot: firing.scheduledSlot?.toISOString() ?? null }, executionSubject: subject.data, originalTurnTask: { taskId: run.workflowTaskId, taskName: run.workflowTaskName, idempotencyKey: run.workflowTaskKey }, cancellation: _Cancellation(run) };
	}
}

/** Opens the read-only progress projection in the shared transaction envelope. */
export class PrismaRoutineRunProgressUnitOfWork implements RoutineRunProgressFactsRepository
{
	/** Root Prisma client used only by the shared unit-of-work runner. */
	public constructor(private readonly prisma: PrismaClient) {}

	/** Read one historical routine run without current authorization or persistence writes. */
	public read(runId: string, attempt: number): Promise<RoutineRunProgressFacts | null>
	{
		const prisma = this.prisma;
		return ___DoWithTrace("routine.run_progress_read", { runId, attempt }, function _TraceRead()
		{
			return ___RunInPrismaUnitOfWork(prisma, async function _Read(transaction)
			{
				const repository = new PrismaRoutineRunProgressFactsRepository(transaction);
				return repository.read(runId, attempt);
			}, { isolationLevel: "ReadCommitted", operation: "routine-run-progress-read" });
		});
	}
}

/** Verify that the firing is the exact reciprocal stored by routine admission. */
function _MatchesFiring(firing: AgentRoutineFiring | null, run: AgentRun): firing is AgentRoutineFiring
{
	return firing !== null && firing.runId === run.id && firing.siloId === run.siloId && firing.routineId === run.routineId && firing.routineRevision === run.routineRevision && firing.conversationId === run.conversationId && firing.scheduledSlot?.getTime() === run.routineScheduledSlot?.getTime() && firing.requesterPrincipalId.length > 0;
}

/** Verify the routine origin retained in the immutable input snapshot. */
function _MatchesOrigin(origin: unknown, run: AgentRun, firing: AgentRoutineFiring): boolean
{
	const parsed = ___RunInputOriginSchema.safeParse(origin);
	if (!parsed.success || parsed.data.kind === AgentRunTriggers.Interactive)
		return false;
	const value = parsed.data;
	return value.kind === (run.trigger === AgentRunTrigger.Scheduled ? "scheduled" : "manual") && value.firingId === firing.id && value.routineId === run.routineId && value.routineRevision === run.routineRevision && value.scheduledSlot === (run.routineScheduledSlot?.toISOString() ?? null) && value.requesterPrincipalId === firing.requesterPrincipalId && value.workflowTaskId === firing.workflowTaskId && value.workflowTaskName === firing.workflowTaskName && value.workflowTaskKey === firing.workflowTaskKey;
}

/** Remove the stored digest before recomputing the canonical snapshot digest. */
function _WithoutDigest(snapshot: ReturnType<typeof _RunInputSnapshot>): Omit<ReturnType<typeof _RunInputSnapshot>, "digest">
{
	const { digest: _digest, ...content } = snapshot;
	return content;
}

/** Project cancellation fields only when admission persisted the complete bundle. */
function _Cancellation(run: AgentRun): RoutineRunProgressCancellation | null
{
	const fields = [run.cancellationCommandId, run.cancellationCommandDigest, run.cancellationBootstrapId, run.cancellationDecision, run.cancellationDecidedAt];
	if (fields.every(value => value === null))
		return null;
	if (run.cancellationCommandId === null || run.cancellationCommandDigest === null || run.cancellationBootstrapId === null)
		throw new Error("Routine run progress found partial cancellation evidence");
	return { commandId: run.cancellationCommandId, commandDigest: run.cancellationCommandDigest, bootstrapId: run.cancellationBootstrapId, decision: _CancellationDecision(run.cancellationDecision), decidedAt: run.cancellationDecidedAt?.toISOString() ?? null };
}

const _STATE_BY_PRISMA: Readonly<Record<PrismaAgentRunState, ModelAgentRunState>> = {
	[PrismaAgentRunState.Accepted]: AgentRunStates.Accepted,
	[PrismaAgentRunState.Queued]: AgentRunStates.Queued,
	[PrismaAgentRunState.Assigned]: AgentRunStates.Assigned,
	[PrismaAgentRunState.Running]: AgentRunStates.Running,
	[PrismaAgentRunState.WaitingForInput]: AgentRunStates.WaitingForInput,
	[PrismaAgentRunState.RecoveryRequired]: AgentRunStates.RecoveryRequired,
	[PrismaAgentRunState.Cancelling]: AgentRunStates.Cancelling,
	[PrismaAgentRunState.Completed]: AgentRunStates.Completed,
	[PrismaAgentRunState.Cancelled]: AgentRunStates.Cancelled,
	[PrismaAgentRunState.Failed]: AgentRunStates.Failed,
};

/** Map the generated Prisma lifecycle enum to the lowercase model vocabulary. */
function _State(value: PrismaAgentRunState): ModelAgentRunState
{
	return _STATE_BY_PRISMA[value as PrismaAgentRunState];
}

const _TERMINAL_REASON_BY_PRISMA: Readonly<Record<PrismaAgentRunTerminalReason, ModelAgentRunTerminalReason>> = {
	[PrismaAgentRunTerminalReason.Success]: AgentRunTerminalReasons.Success,
	[PrismaAgentRunTerminalReason.PolicyDenied]: AgentRunTerminalReasons.PolicyDenied,
	[PrismaAgentRunTerminalReason.BudgetExhausted]: AgentRunTerminalReasons.BudgetExhausted,
	[PrismaAgentRunTerminalReason.RuntimeFailure]: AgentRunTerminalReasons.RuntimeFailure,
	[PrismaAgentRunTerminalReason.InvalidInput]: AgentRunTerminalReasons.InvalidInput,
	[PrismaAgentRunTerminalReason.UserCancelled]: AgentRunTerminalReasons.UserCancelled,
};

/** Map the generated Prisma terminal enum to the lowercase model vocabulary. */
function _TerminalReason(value: PrismaAgentRunTerminalReason | null): ModelAgentRunTerminalReason | null
{
	return value === null ? null : _TERMINAL_REASON_BY_PRISMA[value];
}

/** Map the generated Prisma cancellation winner to the model-neutral value. */
function _CancellationDecision(value: AgentRun["cancellationDecision"]): RoutineRunProgressCancellationDecisions | null
{
	if (value === null)
		return null;
	return value === AgentRunCancellationDecision.CancellationWon ? RoutineRunProgressCancellationDecisions.CancellationWon : RoutineRunProgressCancellationDecisions.OutputWon;
}
