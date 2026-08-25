import { AgentRunState, Prisma } from "@prisma/client";

import { ToolInvocationRunRecoveryEnterResults, type ToolInvocationRunRecoveryAuthority, type ToolInvocationRunRecoveryCommand, type ToolInvocationRunRecoveryEnterResult } from "@opencrane/backend/server/iam/authorization";

import type { ToolInvocationRunRecoveryRepository, ToolInvocationRunRecoveryUnitOfWork } from "./tool-invocation-run-recovery-authority.types";

/**
 * Moves a run in and out of RecoveryRequired on behalf of the authorization package.
 *
 * Authorization decides that a tool invocation needs recovery, but must not know how AgentRun is
 * stored; this adapter is that seam. Both transitions run on the caller's transaction and never
 * move a run out of a cancelling or finished state, so recovery can never resurrect a run that
 * has already stopped.
 *
 * Called by: `apps/opencrane/src/app/external-action-composition.ts`, which injects it into the
 * authorization package's tool-invocation recovery path.
 *
 * @implements ToolInvocationRunRecoveryAuthority
 */
export class PrismaToolInvocationRunRecoveryAuthority implements ToolInvocationRunRecoveryAuthority
{
	/** Moves the run into RecoveryRequired, using the transaction the caller already holds. */
	enterRecoveryRequiredInTransaction(transaction: unknown, command: ToolInvocationRunRecoveryCommand): Promise<ToolInvocationRunRecoveryEnterResult>
	{
		const unitOfWork = new PrismaToolInvocationRunRecoveryUnitOfWork(transaction as Prisma.TransactionClient);
		return unitOfWork.enterRecoveryRequired(command);
	}

	/** Resume Running only when authorization has proved no invocation still requires recovery. */
	resumeRunningInTransaction(transaction: unknown, command: ToolInvocationRunRecoveryCommand): Promise<boolean>
	{
		const unitOfWork = new PrismaToolInvocationRunRecoveryUnitOfWork(transaction as Prisma.TransactionClient);
		return unitOfWork.resumeRunning(command);
	}
}

/** Builds the run-recovery repository, bound to the caller's transaction. */
class PrismaToolInvocationRunRecoveryUnitOfWork implements ToolInvocationRunRecoveryUnitOfWork
{
	/** The transaction the caller opened for this invocation change. */
	private readonly transaction: Prisma.TransactionClient;

	/** Keeps every recovery state change on the caller's transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Moves the run into RecoveryRequired, never out of a cancelling or finished state. */
	enterRecoveryRequired(command: ToolInvocationRunRecoveryCommand): Promise<ToolInvocationRunRecoveryEnterResult>
	{
		return this._repository().enterRecoveryRequired(command);
	}

	/** Moves the run back to Running, never out of a cancelling or finished state. */
	resumeRunning(command: ToolInvocationRunRecoveryCommand): Promise<boolean>
	{
		return this._repository().resumeRunning(command);
	}

	/** Builds the repository on this unit of work's transaction. */
	private _repository(): PrismaToolInvocationRunRecoveryRepository
	{
		return new PrismaToolInvocationRunRecoveryRepository(this.transaction);
	}
}

/** Prisma repository that changes the AgentRun recovery state, each change as one compare-and-set. */
class PrismaToolInvocationRunRecoveryRepository implements ToolInvocationRunRecoveryRepository
{
	/** The caller's transaction for this invocation state change. */
	private readonly transaction: Prisma.TransactionClient;

	/** Bind every AgentRun read and write to the caller-owned invocation transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Moves the run from Running to RecoveryRequired, or reports that this attempt is already there. */
	async enterRecoveryRequired(command: ToolInvocationRunRecoveryCommand): Promise<ToolInvocationRunRecoveryEnterResult>
	{
		const changed = await this.transaction.agentRun.updateMany({ where: { id: command.runId, attempt: command.attempt, state: AgentRunState.Running }, data: { state: AgentRunState.RecoveryRequired } });
		if (changed.count === 1) return ToolInvocationRunRecoveryEnterResults.Entered;
		const state = await this._state(command);
		if (state === AgentRunState.RecoveryRequired) return ToolInvocationRunRecoveryEnterResults.AlreadyRecoveryRequired;
		if (state === AgentRunState.Cancelling) return ToolInvocationRunRecoveryEnterResults.Cancelling;
		return ToolInvocationRunRecoveryEnterResults.Conflict;
	}

	/** Moves the run from RecoveryRequired back to Running, or reports that this attempt is already Running. */
	async resumeRunning(command: ToolInvocationRunRecoveryCommand): Promise<boolean>
	{
		const changed = await this.transaction.agentRun.updateMany({ where: { id: command.runId, attempt: command.attempt, state: AgentRunState.RecoveryRequired }, data: { state: AgentRunState.Running } });
		if (changed.count === 1) return true;
		return this._hasState(command, AgentRunState.Running);
	}

	/** After a compare-and-set matched no rows, checks whether the run is already in the state we wanted. */
	private async _hasState(command: ToolInvocationRunRecoveryCommand, state: AgentRunState): Promise<boolean>
	{
		return await this._state(command) === state;
	}

	/** Returns the run's state, but only if the run row is still on this attempt. */
	private async _state(command: ToolInvocationRunRecoveryCommand): Promise<AgentRunState | null>
	{
		const run = await this.transaction.agentRun.findUnique({ where: { id: command.runId }, select: { attempt: true, state: true } });
		return run !== null && run.attempt === command.attempt ? run.state : null;
	}
}
