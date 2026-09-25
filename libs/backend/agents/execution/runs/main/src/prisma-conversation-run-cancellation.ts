import { AgentRunCancellationDecision, AgentRunState, AgentRunTerminalReason, Prisma, ToolInvocationState } from "@prisma/client";
import { ___ExecutionSubjectSchema } from "@opencrane/contracts";
import { PrismaRunWorkCancellationRepository, type RunWorkCancellationRepository } from "@opencrane/backend/server/iam/authorization";

import { ConversationRunCancellationDecisions, type ConversationRunCancellationAdmission, type ConversationRunCancellationAdmissionCommand, type ConversationRunCancellationDecisionCommand, type ConversationRunCancellationRepository, type ConversationRunCancellationTargetCommand, type ConversationRunCancellationTaskReceipt } from "./conversation-run-cancellation.types";
import { ConversationRunCancellationDenied } from "./conversation-run-cancellation-denied";

/** Persists requester-bound cancellation state on the AgentRun that owns the original turn. */
export class PrismaConversationRunCancellationRepository implements ConversationRunCancellationRepository
{
	/** Owns cancellation cleanup through the same transaction as the run state. */
	private readonly work: RunWorkCancellationRepository;

	/** Keeps IAM cleanup behind its owning transaction-bound port. */
	public constructor(private readonly transaction: Prisma.TransactionClient)
	{
		this.work = new PrismaRunWorkCancellationRepository(this.transaction);
	}

	/** Reads one saved admission without selecting a current turn. */
	public async read(commandId: string): Promise<ConversationRunCancellationAdmission | null>
	{
		const row = await this.transaction.agentRun.findUnique({ where: { cancellationCommandId: commandId } });
		return row === null ? null : _Admission(row);
	}

	/** Rechecks target ownership and returns the original immutable turn task. */
	public async verifyTarget(command: ConversationRunCancellationTargetCommand): Promise<ConversationRunCancellationTaskReceipt>
	{
		return _TaskReceipt(await this._Target(command), command.expectedOriginalTurnTaskName);
	}

	/** Validates the frozen execution subject and stores the cancellation workflow receipt. */
	public async admit(command: ConversationRunCancellationAdmissionCommand): Promise<ConversationRunCancellationAdmission>
	{
		const transaction = this.transaction;
		const existing = await this.read(command.commandId);
		if (existing !== null)
		{
			_AssertSameAdmission(existing, command);
			return existing;
		}
		const run = await this._Target(command);
		const originalTurnTask = _TaskReceipt(run, command.expectedOriginalTurnTaskName);
		if (originalTurnTask.taskId !== command.originalTurnTask.taskId || originalTurnTask.taskName !== command.originalTurnTask.taskName || originalTurnTask.idempotencyKey !== command.originalTurnTask.idempotencyKey)
			throw new ConversationRunCancellationDenied("conversation Stop requires the selected original turn task");
		const changed = await transaction.agentRun.updateMany({ where: { id: command.runId, siloId: command.siloId, attempt: command.attempt, state: run.state, cancellationCommandId: null }, data: { state: AgentRunState.Cancelling, cancellationCommandId: command.commandId, cancellationCommandDigest: command.commandDigest, cancellationBootstrapId: command.bootstrapId, cancellationRequestedByPrincipalId: command.requesterPrincipalId, cancellationRequestedAt: command.requestedAt, cancellationAuthorizationDecisionDigest: command.authorizationDecisionDigest, cancellationWorkflowTaskId: command.cancellationTask.taskId, cancellationWorkflowTaskName: command.cancellationTask.taskName, cancellationWorkflowTaskKey: command.cancellationTask.idempotencyKey } });
		if (changed.count !== 1)
		{
			const winner = await this.read(command.commandId);
			if (winner !== null)
			{
				_AssertSameAdmission(winner, command);
				return winner;
			}
			const current = await transaction.agentRun.findUnique({ where: { id: command.runId }, select: { state: true, cancellationCommandId: true } });
			if (current !== null && (!_IsCancellableRunState(current.state) || current.cancellationCommandId !== null))
				throw new ConversationRunCancellationDenied("conversation Stop target changed before admission");
			throw new Error("conversation Stop lost its run admission fence");
		}
		const admitted = await this.read(command.commandId);
		if (admitted === null)
			throw new Error("conversation Stop admission is unavailable after its write");
		return admitted;
	}

	/** Records the verified Kurrent winner without performing cancellation cleanup. */
	public async recordDecision(command: ConversationRunCancellationDecisionCommand): Promise<void>
	{
		const transaction = this.transaction;
		const run = await transaction.agentRun.findUnique({ where: { cancellationCommandId: command.commandId } });
		if (run === null || run.cancellationCommandDigest !== command.commandDigest)
			throw new Error("conversation Stop decision requires its saved command");
		const decision = command.decision === ConversationRunCancellationDecisions.OutputWon ? AgentRunCancellationDecision.OutputWon : AgentRunCancellationDecision.CancellationWon;
		if (run.cancellationDecision !== null)
		{
			if (run.cancellationDecision !== decision)
				throw new Error("conversation Stop cannot replace its terminal winner");
			return;
		}
		const outputWon = command.decision === ConversationRunCancellationDecisions.OutputWon;
		const data = outputWon
			? { cancellationDecision: decision, cancellationDecidedAt: command.decidedAt, state: AgentRunState.Completed, terminalReason: AgentRunTerminalReason.Success, finishedAt: command.decidedAt }
			: { cancellationDecision: decision, cancellationDecidedAt: command.decidedAt };
		const changed = await transaction.agentRun.updateMany({ where: { id: run.id, attempt: run.attempt, state: AgentRunState.Cancelling, cancellationCommandId: command.commandId, cancellationCommandDigest: command.commandDigest, cancellationDecision: null }, data });
		if (changed.count !== 1)
			throw new Error("conversation Stop lost its terminal decision fence");
	}

	/** Runs IAM cleanup only after the saved decision says cancellation won. */
	public async cleanup(commandId: string, commandDigest: string, now: Date)
	{
		const run = await this._CancellationWinner(commandId, commandDigest);
		return this.work.cancel({ runId: run.id, attempt: run.attempt, now });
	}

	/** Finalizes UserCancelled only when no provider claim remains active. */
	public async finalize(commandId: string, commandDigest: string, now: Date): Promise<boolean>
	{
		const transaction = this.transaction;
		const run = await transaction.agentRun.findUnique({ where: { cancellationCommandId: commandId } });
		if (run === null || run.cancellationCommandDigest !== commandDigest || run.cancellationDecision !== AgentRunCancellationDecision.CancellationWon)
			throw new Error("conversation Stop finalization requires its saved cancellation winner");
		if (run.state === AgentRunState.Cancelled)
			return run.terminalReason === AgentRunTerminalReason.UserCancelled && run.finishedAt !== null;
		if (run.state !== AgentRunState.Cancelling)
			throw new Error("conversation Stop finalization found another terminal state");
		const activeClaims = await transaction.toolInvocation.count({ where: { runId: run.id, attempt: run.attempt, claimKind: { not: null }, state: { in: [ToolInvocationState.Claimed, ToolInvocationState.Reconciling] } } });
		if (activeClaims !== 0)
			return false;
		const changed = await transaction.agentRun.updateMany({ where: { id: run.id, attempt: run.attempt, state: AgentRunState.Cancelling, cancellationCommandId: commandId, cancellationCommandDigest: commandDigest, cancellationDecision: AgentRunCancellationDecision.CancellationWon }, data: { state: AgentRunState.Cancelled, terminalReason: AgentRunTerminalReason.UserCancelled, finishedAt: now } });
		if (changed.count === 1)
			return true;
		const winner = await transaction.agentRun.findUnique({ where: { id: run.id }, select: { state: true, cancellationCommandId: true, cancellationCommandDigest: true, cancellationDecision: true } });
		return winner?.state === AgentRunState.Cancelled && winner.cancellationCommandId === commandId && winner.cancellationCommandDigest === commandDigest && winner.cancellationDecision === AgentRunCancellationDecision.CancellationWon;
	}

	/** Returns the checked cancellation winner run for cleanup. */
	private async _CancellationWinner(commandId: string, commandDigest: string)
	{
		const run = await this.transaction.agentRun.findUnique({ where: { cancellationCommandId: commandId } });
		if (run === null || run.state !== AgentRunState.Cancelling || run.cancellationCommandDigest !== commandDigest || run.cancellationDecision !== AgentRunCancellationDecision.CancellationWon)
			throw new Error("conversation Stop cleanup requires its saved cancellation winner");
		return run;
	}

	/** Returns the current cancellable run only when its frozen requester and lease match. */
	private async _Target(command: ConversationRunCancellationTargetCommand)
	{
		const run = await this.transaction.agentRun.findFirst({ where: { id: command.runId, siloId: command.siloId, conversationId: command.conversationId, attempt: command.attempt } });
		if (run === null)
			throw new ConversationRunCancellationDenied("conversation Stop requires the selected run attempt");
		_AssertRunAuthority(run, command);
		if (!_IsCancellableRunState(run.state))
			throw new ConversationRunCancellationDenied("conversation Stop cannot cancel the run's current state");
		return run;
	}
}

/** Reads the complete original workflow receipt from a verified run. */
function _TaskReceipt(run: Prisma.AgentRunGetPayload<Record<string, never>>, expectedTaskName: string): ConversationRunCancellationTaskReceipt
{
	if (run.workflowTaskId === null || run.workflowTaskName !== expectedTaskName || run.workflowTaskKey === null)
		throw new ConversationRunCancellationDenied("conversation Stop requires the original turn workflow receipt");
	return { taskId: run.workflowTaskId, taskName: run.workflowTaskName, idempotencyKey: run.workflowTaskKey };
}

type _CancellableRunState = typeof AgentRunState.Accepted | typeof AgentRunState.Running | typeof AgentRunState.WaitingForInput | typeof AgentRunState.RecoveryRequired;

/** Narrow Prisma state to the only states the SQL admission permits to enter Cancelling. */
function _IsCancellableRunState(state: AgentRunState): state is _CancellableRunState
{
	return state === AgentRunState.Accepted || state === AgentRunState.Running || state === AgentRunState.WaitingForInput || state === AgentRunState.RecoveryRequired;
}

/** Verifies that the run's frozen requester, computer lease and turn receipt match admission. */
function _AssertRunAuthority(run: Prisma.AgentRunGetPayload<Record<string, never>>, command: ConversationRunCancellationTargetCommand): void
{
	const subject = ___ExecutionSubjectSchema.safeParse(run.executionSubject);
	if (!subject.success || subject.data.siloId !== command.siloId || subject.data.runScope.runId !== command.runId || subject.data.runScope.attempt !== command.attempt || subject.data.computerScope.computerId !== command.computerId || subject.data.computerScope.leaseId !== command.leaseId || subject.data.computerScope.leaseGeneration !== command.leaseGeneration || subject.data.requester.requesterPrincipalId !== command.requesterPrincipalId)
		throw new ConversationRunCancellationDenied("conversation Stop requires the original requester and execution subject");
}

/** Maps a complete persisted cancellation bundle into its package contract. */
function _Admission(row: Prisma.AgentRunGetPayload<Record<string, never>>): ConversationRunCancellationAdmission
{
	if (row.conversationId === null || row.cancellationCommandId === null || row.cancellationCommandDigest === null || row.cancellationBootstrapId === null || row.cancellationRequestedByPrincipalId === null || row.cancellationRequestedAt === null || row.cancellationAuthorizationDecisionDigest === null || row.cancellationWorkflowTaskId === null || row.cancellationWorkflowTaskName === null || row.cancellationWorkflowTaskKey === null || row.workflowTaskId === null || row.workflowTaskName === null || row.workflowTaskKey === null)
		throw new Error("conversation Stop admission is incomplete");
	const subject = ___ExecutionSubjectSchema.parse(row.executionSubject);
	return { runId: row.id, siloId: row.siloId, conversationId: row.conversationId, attempt: row.attempt, computerId: subject.computerScope.computerId, leaseId: subject.computerScope.leaseId, leaseGeneration: subject.computerScope.leaseGeneration, expectedOriginalTurnTaskName: row.workflowTaskName, bootstrapId: row.cancellationBootstrapId, commandId: row.cancellationCommandId, commandDigest: row.cancellationCommandDigest, requesterPrincipalId: row.cancellationRequestedByPrincipalId, authorizationDecisionDigest: row.cancellationAuthorizationDecisionDigest, requestedAt: row.cancellationRequestedAt, originalTurnTask: { taskId: row.workflowTaskId, taskName: row.workflowTaskName, idempotencyKey: row.workflowTaskKey }, cancellationTask: { taskId: row.cancellationWorkflowTaskId, taskName: row.cancellationWorkflowTaskName, idempotencyKey: row.cancellationWorkflowTaskKey } };
}

/** Rejects a command id replay whose saved admission differs from the new request. */
function _AssertSameAdmission(saved: ConversationRunCancellationAdmission, requested: ConversationRunCancellationAdmissionCommand): void
{
	if (saved.commandDigest !== requested.commandDigest || saved.runId !== requested.runId || saved.bootstrapId !== requested.bootstrapId || saved.requesterPrincipalId !== requested.requesterPrincipalId || saved.cancellationTask.taskId !== requested.cancellationTask.taskId)
		throw new ConversationRunCancellationDenied("conversation Stop command was already admitted for another target");
}
