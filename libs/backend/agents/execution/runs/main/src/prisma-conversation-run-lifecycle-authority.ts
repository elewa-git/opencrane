import { AgentRunState, AgentRunTerminalReason, Prisma, type PrismaClient } from "@prisma/client";

import { ___ExecutionSubjectSchema } from "@opencrane/contracts";
import type { ConversationRunLifecycleAuthority, ConversationRunLifecycleCommand, ConversationRunLifecycleRepository } from "./conversation-run-lifecycle.types";

/**
 * Moves one conversation run through execution after checking its admitted computer lease fence.
 *
 * Called by: `ConversationComputerTurnAuthorityService`, which records bootstrap before credential
 * issuance and completion after durable assistant output.
 * @implements ConversationRunLifecycleAuthority
 */
export class PrismaConversationRunLifecycleUnitOfWork implements ConversationRunLifecycleAuthority
{
	constructor(private readonly prisma: PrismaClient) {}

	/** Idempotently records successful bootstrap handoff before a credential is issued. */
	start(command: ConversationRunLifecycleCommand): Promise<void>
	{
		return this._Transition(command, AgentRunState.Accepted, AgentRunState.Running, false);
	}

	/** Idempotently completes a run after the caller has durably stored assistant output. */
	complete(command: ConversationRunLifecycleCommand): Promise<void>
	{
		return this._Transition(command, AgentRunState.Running, AgentRunState.Completed, true);
	}

	/** Idempotently records a runtime failure after the exact computer attempt loses answer authority. */
	fail(command: ConversationRunLifecycleCommand): Promise<void>
	{
		return this._Run(repository => repository.fail(command));
	}

	/** Checks the stored execution-subject fence before making one serializable state transition. */
	private _Transition(command: ConversationRunLifecycleCommand, from: AgentRunState, to: AgentRunState, terminal: boolean): Promise<void>
	{
		return this._Run(repository => repository.transition(command, from, to, terminal));
	}

	/** Construct the transaction-bound repository once for every lifecycle operation. */
	private _Run(operation: (repository: PrismaConversationRunLifecycleRepository) => Promise<void>): Promise<void>
	{
		return this.prisma.$transaction(async function _Run(transaction)
		{
			return operation(new PrismaConversationRunLifecycleRepository(transaction));
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}

/** Persists one exact lifecycle transition inside its caller-owned transaction. */
class PrismaConversationRunLifecycleRepository implements ConversationRunLifecycleRepository
{
	constructor(private readonly transaction: Prisma.TransactionClient) {}

	async transition(command: ConversationRunLifecycleCommand, from: string, to: string, terminal: boolean): Promise<void>
	{
		const run = await this.transaction.agentRun.findFirst({ where: { id: command.runId, siloId: command.siloId, attempt: command.attempt }, select: { state: true, executionSubject: true } });
		if (run === null)
			throw new Error("conversation run lifecycle requires the exact admitted attempt");
		const subject = ___ExecutionSubjectSchema.safeParse(run.executionSubject);
		if (!subject.success || subject.data.runScope.runId !== command.runId || subject.data.runScope.attempt !== command.attempt || subject.data.computerScope.computerId !== command.computerId || subject.data.computerScope.leaseId !== command.lease.leaseId || subject.data.computerScope.leaseGeneration !== command.lease.leaseGeneration)
			throw new Error("conversation run lifecycle requires the admitted computer lease fence");
		if (run.state === to)
			return;
		if (run.state !== from)
			throw new Error("conversation run lifecycle cannot transition from the current state");
		const changed = await this.transaction.agentRun.updateMany({ where: { id: command.runId, siloId: command.siloId, attempt: command.attempt, state: from as AgentRunState }, data: terminal ? { state: to as AgentRunState, terminalReason: AgentRunTerminalReason.Success, finishedAt: new Date() } : { state: to as AgentRunState, startedAt: new Date() } });
		if (changed.count !== 1)
			throw new Error("conversation run lifecycle lost its state transition fence");
	}

	/** Terminalize only the accepted or running lease-fenced attempt, preserving failure as idempotent. */
	async fail(command: ConversationRunLifecycleCommand): Promise<void>
	{
		const run = await this.transaction.agentRun.findFirst({ where: { id: command.runId, siloId: command.siloId, attempt: command.attempt }, select: { state: true, executionSubject: true } });
		if (run === null)
			throw new Error("conversation run lifecycle requires the exact admitted attempt");
		const subject = ___ExecutionSubjectSchema.safeParse(run.executionSubject);
		if (!subject.success || subject.data.runScope.runId !== command.runId || subject.data.runScope.attempt !== command.attempt || subject.data.computerScope.computerId !== command.computerId || subject.data.computerScope.leaseId !== command.lease.leaseId || subject.data.computerScope.leaseGeneration !== command.lease.leaseGeneration)
			throw new Error("conversation run lifecycle requires the admitted computer lease fence");
		if (run.state === AgentRunState.Failed)
			return;
		if (run.state !== AgentRunState.Accepted && run.state !== AgentRunState.Running)
			throw new Error("conversation run lifecycle cannot fail from the current state");
		const changed = await this.transaction.agentRun.updateMany({ where: { id: command.runId, siloId: command.siloId, attempt: command.attempt, state: { in: [AgentRunState.Accepted, AgentRunState.Running] } }, data: { state: AgentRunState.Failed, terminalReason: AgentRunTerminalReason.RuntimeFailure, finishedAt: new Date() } });
		if (changed.count !== 1)
			throw new Error("conversation run lifecycle lost its failure transition fence");
	}
}
