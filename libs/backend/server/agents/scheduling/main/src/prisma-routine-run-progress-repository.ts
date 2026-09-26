import { AgentRoutineFiringDisposition, AgentRunState, AgentRunTerminalReason, type Prisma } from "@prisma/client";

import { ___ParseRoutineRunProgressObservation, type RoutineRunProgressObservation, type RoutineRunProgressSink } from "@opencrane/backend/server/agents/scheduling/contract";
import { AgentRunStates, AgentRunTerminalReasons, type AgentRunState as ModelRunState, type AgentRunTerminalReason as ModelTerminalReason } from "@opencrane/models/agents";

import { __MayTransitionRoutineFiringProgress } from "./routine-firing-lifecycle";
import { _MODEL_FIRING_DISPOSITION, _PRISMA_FIRING_DISPOSITION } from "./routine-prisma-mapping";

/** Maps all model states explicitly at the database boundary. */
const _SOURCE_STATE: Readonly<Record<ModelRunState, AgentRunState>> = {
	[AgentRunStates.Accepted]: AgentRunState.Accepted,
	[AgentRunStates.Queued]: AgentRunState.Queued,
	[AgentRunStates.Assigned]: AgentRunState.Assigned,
	[AgentRunStates.Running]: AgentRunState.Running,
	[AgentRunStates.WaitingForInput]: AgentRunState.WaitingForInput,
	[AgentRunStates.RecoveryRequired]: AgentRunState.RecoveryRequired,
	[AgentRunStates.Cancelling]: AgentRunState.Cancelling,
	[AgentRunStates.Completed]: AgentRunState.Completed,
	[AgentRunStates.Cancelled]: AgentRunState.Cancelled,
	[AgentRunStates.Failed]: AgentRunState.Failed,
};

/** Maps all terminal reasons without accepting an unvalidated string as a database enum. */
const _SOURCE_REASON: Readonly<Record<ModelTerminalReason, AgentRunTerminalReason>> = {
	[AgentRunTerminalReasons.Success]: AgentRunTerminalReason.Success,
	[AgentRunTerminalReasons.PolicyDenied]: AgentRunTerminalReason.PolicyDenied,
	[AgentRunTerminalReasons.BudgetExhausted]: AgentRunTerminalReason.BudgetExhausted,
	[AgentRunTerminalReasons.RuntimeFailure]: AgentRunTerminalReason.RuntimeFailure,
	[AgentRunTerminalReasons.InvalidInput]: AgentRunTerminalReason.InvalidInput,
	[AgentRunTerminalReasons.UserCancelled]: AgentRunTerminalReason.UserCancelled,
};

/**
 * Saves progress only while the observed source run still matches its exact attempt and state.
 * The caller owns a serializable transaction across the source read and firing compare-and-set.
 * Conversation producers verify immutable history before calling this port and await it before
 * acknowledging their work; this repository neither reads content nor grants new execution access.
 */
export class PrismaRoutineRunProgressRepository implements RoutineRunProgressSink
{
	/** Caller-owned transaction whose source reads participate in the same serialization fence. */
	constructor(private readonly transaction: Prisma.TransactionClient) {}

	/**
	 * Retains the first evidence pair even when a later verified outcome has different evidence.
	 * A stale source observation or a lost compare-and-set throws before the producer can acknowledge
	 * its milestone, so the producer rereads and retries.
	 */
	async recordRunProgress(observation: RoutineRunProgressObservation): Promise<void>
	{
		const command = ___ParseRoutineRunProgressObservation(observation);
		const run = await this.transaction.agentRun.findFirst({ where: {
			id: command.runId, siloId: command.siloId, attempt: command.attempt,
			routineFiringId: command.firingId, routineId: command.routineId, routineRevision: command.routineRevision,
			inputSnapshotDigest: command.inputSnapshotDigest, state: _SOURCE_STATE[command.sourceState],
			finishedAt: command.sourceFinishedAt === null ? null : new Date(command.sourceFinishedAt),
			terminalReason: command.sourceTerminalReason === null ? null : _SOURCE_REASON[command.sourceTerminalReason],
			cancellationCommandId: command.sourceCancellationCommandId,
			cancellationCommandDigest: command.sourceCancellationCommandDigest,
		}, select: { id: true } });
		if (run === null)
			throw new Error("routine run progress source changed or no longer matches");
		const identity = { id: command.firingId, siloId: command.siloId, routineId: command.routineId, routineRevision: command.routineRevision, runId: command.runId };
		const firing = await this.transaction.agentRoutineFiring.findFirst({ where: identity, select: { disposition: true, resultReference: true, resultDigest: true } });
		if (firing === null)
			throw new Error("routine run progress does not match a linked firing");
		if ((firing.resultReference === null) !== (firing.resultDigest === null))
			throw new Error("routine run progress found incomplete saved result evidence");
		const target = _PRISMA_FIRING_DISPOSITION[command.disposition];
		if (firing.disposition === target)
		{
			if (command.resultReference !== null && firing.resultReference === null)
				throw new Error("routine run progress replay is missing saved result evidence");
			return;
		}
		if (!__MayTransitionRoutineFiringProgress(_MODEL_FIRING_DISPOSITION[firing.disposition], command.disposition))
			throw new Error("routine run progress transition is not allowed");
		const clock = await this.transaction.agentRunAuthorityClock.findUnique({ where: { singleton: 1 }, select: { now: true } });
		if (clock === null || !Number.isFinite(clock.now.getTime()))
			throw new Error("routine database clock is unavailable");
		const terminal = target === AgentRoutineFiringDisposition.Completed || target === AgentRoutineFiringDisposition.Cancelled;
		const changed = await this.transaction.agentRoutineFiring.updateMany({
			where: { ...identity, disposition: firing.disposition, resultReference: firing.resultReference, resultDigest: firing.resultDigest },
			data: {
				disposition: target,
				resultReference: firing.resultReference ?? command.resultReference,
				resultDigest: firing.resultDigest ?? command.resultDigest,
				finishedAt: terminal ? clock.now : null,
				updatedAt: clock.now,
			},
		});
		if (changed.count !== 1)
			throw new Error("routine run progress compare-and-set conflict");
	}
}
