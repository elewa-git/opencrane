import { AgentRunState, AgentRunTerminalReason, Prisma, type PrismaClient } from "@prisma/client";

import { ___ExecutionSubjectSchema } from "@opencrane/contracts";
import { ConversationRunLifecycleEvents, type ConversationRunLifecycleAuthority, type ConversationRunLifecycleCommand, type ConversationRunLifecycleRepository } from "./conversation-run-lifecycle.types";

/** Exhaustive state and write rules for every lifecycle event. */
const _LIFECYCLE_TRANSITIONS = {
	[ConversationRunLifecycleEvents.Start]: { source: AgentRunState.Accepted, target: AgentRunState.Running, idempotentStates: [AgentRunState.Running, AgentRunState.RecoveryRequired], data: function _StartData() { return { state: AgentRunState.Running, startedAt: new Date() }; } },
	[ConversationRunLifecycleEvents.EnterRecoveryRequired]: { source: AgentRunState.Running, target: AgentRunState.RecoveryRequired, idempotentStates: [AgentRunState.RecoveryRequired], data: function _RecoveryData() { return { state: AgentRunState.RecoveryRequired }; } },
	[ConversationRunLifecycleEvents.Complete]: { source: AgentRunState.Running, target: AgentRunState.Completed, idempotentStates: [AgentRunState.Completed], data: function _CompletionData() { return { state: AgentRunState.Completed, terminalReason: AgentRunTerminalReason.Success, finishedAt: new Date() }; } },
} satisfies Record<ConversationRunLifecycleEvents, { readonly source: AgentRunState; readonly target: AgentRunState; readonly idempotentStates: readonly AgentRunState[]; readonly data: () => Prisma.AgentRunUpdateManyMutationInput }>;

/**
 * Moves one conversation run through execution after checking its admitted computer lease fence.
 *
 * Called by: `ConversationComputerTurnAuthorityService`, which records bootstrap before credential
 * issuance, recovery after a saved ambiguous model response, and completion after durable output.
 * @implements ConversationRunLifecycleAuthority
 */
export class PrismaConversationRunLifecycleUnitOfWork implements ConversationRunLifecycleAuthority
{
	/** Binds every lifecycle transition to the product database. */
	constructor(private readonly prisma: PrismaClient) {}

	/** Idempotently records successful bootstrap handoff before a credential is issued. */
	start(command: ConversationRunLifecycleCommand): Promise<void>
	{
		return this._Transition(command, ConversationRunLifecycleEvents.Start);
	}

	/** Idempotently preserves a paid model response ambiguity without ending the run. */
	enterRecoveryRequired(command: ConversationRunLifecycleCommand): Promise<void>
	{
		return this._Transition(command, ConversationRunLifecycleEvents.EnterRecoveryRequired);
	}

	/** Idempotently completes a run after the caller has durably stored assistant output. */
	complete(command: ConversationRunLifecycleCommand): Promise<void>
	{
		return this._Transition(command, ConversationRunLifecycleEvents.Complete);
	}

	/** Checks the stored execution-subject fence before making one serializable state transition. */
	private _Transition(command: ConversationRunLifecycleCommand, event: ConversationRunLifecycleEvents): Promise<void>
	{
		return this.prisma.$transaction(async function _Run(transaction)
		{
			return new PrismaConversationRunLifecycleRepository(transaction).transition(command, event);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}

/** Persists one exact lifecycle transition inside its caller-owned transaction. */
class PrismaConversationRunLifecycleRepository implements ConversationRunLifecycleRepository
{
	/** Binds every lifecycle read and compare-and-set to one serializable transaction. */
	constructor(private readonly transaction: Prisma.TransactionClient) {}

	/** Checks the saved lease fence before one idempotent state transition. */
	async transition(command: ConversationRunLifecycleCommand, event: ConversationRunLifecycleEvents): Promise<void>
	{
		const transition = _LIFECYCLE_TRANSITIONS[event];
		const run = await this.transaction.agentRun.findFirst({ where: { id: command.runId, siloId: command.siloId, attempt: command.attempt }, select: { state: true, executionSubject: true } });
		if (run === null)
			throw new Error("conversation run lifecycle requires the exact admitted attempt");
		const subject = ___ExecutionSubjectSchema.safeParse(run.executionSubject);
		if (!subject.success || subject.data.siloId !== command.siloId || subject.data.runScope.runId !== command.runId || subject.data.runScope.attempt !== command.attempt || subject.data.computerScope.computerId !== command.computerId || subject.data.computerScope.leaseId !== command.lease.leaseId || subject.data.computerScope.leaseGeneration !== command.lease.leaseGeneration)
			throw new Error("conversation run lifecycle requires the admitted computer lease fence");
		if (transition.idempotentStates.some(state => state === run.state))
			return;
		if (run.state !== transition.source)
			throw new Error("conversation run lifecycle cannot transition from the current state");
		const changed = await this.transaction.agentRun.updateMany({ where: { id: command.runId, siloId: command.siloId, attempt: command.attempt, state: transition.source }, data: transition.data() });
		if (changed.count !== 1)
			throw new Error("conversation run lifecycle lost its state transition fence");
	}
}
