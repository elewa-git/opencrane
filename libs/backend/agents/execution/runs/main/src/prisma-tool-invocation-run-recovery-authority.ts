import { AgentRunState, Prisma } from "@prisma/client";

import { ToolInvocationRunRecoveryEnterResults, type ToolInvocationRunRecoveryAuthority, type ToolInvocationRunRecoveryCommand, type ToolInvocationRunRecoveryEnterResult } from "@opencrane/backend/server/iam/authorization";

import type { ToolInvocationRunRecoveryRepository, ToolInvocationRunRecoveryUnitOfWork } from "./tool-invocation-run-recovery-authority.types.js";

/** Runs-owned adapter injected into authorization without exposing AgentRun persistence. */
export class PrismaToolInvocationRunRecoveryAuthority implements ToolInvocationRunRecoveryAuthority
{
	/** Enter RecoveryRequired inside the invocation owner's existing transaction. */
	enterRecoveryRequiredInTransaction(transaction: unknown, command: ToolInvocationRunRecoveryCommand): Promise<ToolInvocationRunRecoveryEnterResult>
	{
		return new PrismaToolInvocationRunRecoveryUnitOfWork(transaction as Prisma.TransactionClient).enterRecoveryRequired(command);
	}

	/** Resume Running only when authorization has proved no invocation still requires recovery. */
	resumeRunningInTransaction(transaction: unknown, command: ToolInvocationRunRecoveryCommand): Promise<boolean>
	{
		return new PrismaToolInvocationRunRecoveryUnitOfWork(transaction as Prisma.TransactionClient).resumeRunning(command);
	}
}

/** Transaction owner that constructs the exact run recovery repository. */
class PrismaToolInvocationRunRecoveryUnitOfWork implements ToolInvocationRunRecoveryUnitOfWork
{
	/** Caller-owned invocation transaction. */
	private readonly transaction: Prisma.TransactionClient;

	/** Bind recovery state changes to the invocation transition transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Enter the explicit recovery state without crossing cancellation or terminal states. */
	enterRecoveryRequired(command: ToolInvocationRunRecoveryCommand): Promise<ToolInvocationRunRecoveryEnterResult>
	{
		return this._repository().enterRecoveryRequired(command);
	}

	/** Resume the run without crossing cancellation or terminal states. */
	resumeRunning(command: ToolInvocationRunRecoveryCommand): Promise<boolean>
	{
		return this._repository().resumeRunning(command);
	}

	/** Construct one repository over the unit's exact transaction binding. */
	private _repository(): PrismaToolInvocationRunRecoveryRepository
	{
		return new PrismaToolInvocationRunRecoveryRepository(this.transaction);
	}
}

/** Prisma repository that owns exact AgentRun recovery state compare-and-set operations. */
class PrismaToolInvocationRunRecoveryRepository implements ToolInvocationRunRecoveryRepository
{
	/** Exact invocation transition transaction. */
	private readonly transaction: Prisma.TransactionClient;

	/** Bind every AgentRun read and write to the caller-owned invocation transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Enter RecoveryRequired from Running or accept the exact already-entered attempt. */
	async enterRecoveryRequired(command: ToolInvocationRunRecoveryCommand): Promise<ToolInvocationRunRecoveryEnterResult>
	{
		const changed = await this.transaction.agentRun.updateMany({ where: { id: command.runId, attempt: command.attempt, state: AgentRunState.Running }, data: { state: AgentRunState.RecoveryRequired } });
		if (changed.count === 1) return ToolInvocationRunRecoveryEnterResults.Entered;
		const state = await this._state(command);
		if (state === AgentRunState.RecoveryRequired) return ToolInvocationRunRecoveryEnterResults.AlreadyRecoveryRequired;
		if (state === AgentRunState.Cancelling) return ToolInvocationRunRecoveryEnterResults.Cancelling;
		return ToolInvocationRunRecoveryEnterResults.Conflict;
	}

	/** Resume Running from RecoveryRequired or accept the exact already-resumed attempt. */
	async resumeRunning(command: ToolInvocationRunRecoveryCommand): Promise<boolean>
	{
		const changed = await this.transaction.agentRun.updateMany({ where: { id: command.runId, attempt: command.attempt, state: AgentRunState.RecoveryRequired }, data: { state: AgentRunState.Running } });
		if (changed.count === 1) return true;
		return this._hasState(command, AgentRunState.Running);
	}

	/** Verify only an exact idempotent winner after a compare-and-set loss. */
	private async _hasState(command: ToolInvocationRunRecoveryCommand, state: AgentRunState): Promise<boolean>
	{
		return await this._state(command) === state;
	}

	/** Load state only when the durable run still names the exact attempt. */
	private async _state(command: ToolInvocationRunRecoveryCommand): Promise<AgentRunState | null>
	{
		const run = await this.transaction.agentRun.findUnique({ where: { id: command.runId }, select: { attempt: true, state: true } });
		return run !== null && run.attempt === command.attempt ? run.state : null;
	}
}
