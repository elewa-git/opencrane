import { Prisma, type PrismaClient } from "@prisma/client";

import type { JsonValue } from "@opencrane/util";

import { PrismaToolInvocationRepository } from "./prisma-tool-invocation-repository";
import { TOOL_INVOCATION_PREPARATION_POLICY, ToolInvocationStates } from "./tool-invocation-lifecycle.types";
import { ToolInvocationEventTypes, ToolInvocationRunRecoveryEnterResults, type ToolInvocationAdmissionResult, type ToolInvocationClaim, type ToolInvocationClaimResult, type ToolInvocationCompletionResult, type ToolInvocationIntent, type ToolInvocationLifecycleEvent, type ToolInvocationLifecycleEventSink, type ToolInvocationPreparationPolicy, type ToolInvocationRecord, type ToolInvocationRecoveryEvent, type ToolInvocationRecoveryEventSink, type ToolInvocationRunRecoveryAuthority, type ToolInvocationUnitOfWork } from "./tool-invocation.types";
import { PrismaMcpToolInvocationParticipantUnitOfWork } from "./prisma-mcp-tool-invocation-participant";

/** Safe failure category emitted when a provider claim lease expires. */
const _EXPIRED_CLAIM_FAILURE_CODE = "external_action_claim_expired";
/** Safe failure category emitted when the start event could not be persisted. */
const _START_EVENT_FAILURE_CODE = "external_action_start_event_failed";

/**
 * Every tool-call transition, each as its own serializable transaction.
 *
 * This is what the external-action worker holds. Each method opens one transaction, performs the
 * state change through {@link ToolInvocationTransactionRepository}, and appends the run-timeline
 * event in that same transaction — so a timeline entry can never survive a rolled-back transition.
 * The event sinks are ports rather than direct calls because the run-event and recovery tables
 * belong to the runs package.
 *
 * The three sinks and authorities passed to the constructor all participate in the same
 * transaction, and any of them refusing causes a throw that rolls the whole transition back. That
 * is deliberate: a state change nobody can see is worse than a retried transaction.
 *
 * Composed in: apps/opencrane/src/app/external-action-composition.ts.
 * Called by: libs/backend/agents/execution/protocol/src/external-action-worker.ts (through
 * `ExternalActionWorkerDependencies.invocations`).
 */
export class PrismaToolInvocationUnitOfWork implements ToolInvocationUnitOfWork
{
	/** Product-authority client that opens serializable units of work. */
	private readonly _prisma: PrismaClient;
	/** Writes run events for state changes, using the same transaction as the change itself. */
	private readonly _lifecycleEvents: ToolInvocationLifecycleEventSink;
	/** Writes manual-recovery events, using the same transaction as the recovery change. */
	private readonly _recoveryEvents: ToolInvocationRecoveryEventSink;
	/** Changes the run's state, implemented by the runs package and called inside this recovery transaction. */
	private readonly _runRecovery: ToolInvocationRunRecoveryAuthority;

	/** Construct the unit with explicit persistence and event authorities. */
	constructor(prisma: PrismaClient, lifecycleEvents: ToolInvocationLifecycleEventSink, recoveryEvents: ToolInvocationRecoveryEventSink, runRecovery: ToolInvocationRunRecoveryAuthority)
	{
		this._prisma = prisma;
		this._lifecycleEvents = lifecycleEvents;
		this._recoveryEvents = recoveryEvents;
		this._runRecovery = runRecovery;
	}

	/** Admit one candidate as durable Preparing work. */
	async admit(intent: ToolInvocationIntent, now: Date, policy: ToolInvocationPreparationPolicy): Promise<ToolInvocationAdmissionResult>
	{
		return this._execute(async function _admit(repository)
		{
			return repository.admit(intent, now, policy);
		});
	}

	/** Load one invocation from its accepted candidate coordinates. */
	async findByCandidate(runId: string, attempt: number, candidateId: string): Promise<ToolInvocationRecord | null>
	{
		return this._execute(async function _find(repository)
		{
			return repository.findByCandidate(runId, attempt, candidateId);
		});
	}

	/** Return at most one runnable invocation for its exact current run attempt. */
	async findNextRunnable(now: Date): Promise<ToolInvocationRecord | null>
	{
		return this._execute(async function _findRunnable(repository)
		{
			return repository.findNextRunnable(now);
		});
	}

	/** Record provider-free preparation success under its observed revision. */
	async markPrepared(invocationId: string, expectedRevision: number, now: Date): Promise<ToolInvocationRecord | null>
	{
		return this._execute(async function _prepared(repository)
		{
			return repository.markPrepared(invocationId, expectedRevision, now);
		});
	}

	/** Consume one preparation failure and append its safe lifecycle event atomically. */
	async recordPreparationFailure(invocationId: string, expectedRevision: number, now: Date, policy: ToolInvocationPreparationPolicy, failureCode: string): Promise<ToolInvocationRecord | null>
	{
		const lifecycleEvents = this._lifecycleEvents;
		return this._execute(async function _preparationFailure(repository, transaction)
		{
			const transition = await repository.recordPreparationFailure(invocationId, expectedRevision, now, policy, failureCode);
			if (!transition.changed || transition.invocation === null) return transition.invocation;
			const invocation = transition.invocation;
			await _appendLifecycleEvent(lifecycleEvents, transaction, _failedEvent(invocation, invocation.failureCode ?? "external_action_preparation_failed", invocation.state === ToolInvocationStates.Preparing, policy.attemptLimit));
			return invocation;
		});
	}

	/** Acquire one exact provider-operation claim. */
	async claim(invocationId: string, kind: ToolInvocationClaim["kind"], now: Date, leaseMilliseconds: number): Promise<ToolInvocationClaimResult>
	{
		return this._execute(async function _claim(repository)
		{
			return repository.claim(invocationId, kind, now, leaseMilliseconds);
		});
	}

	/** Record success, its result delivery, and the completion event in one transaction. */
	async completeSucceeded(claim: ToolInvocationClaim, result: JsonValue, now: Date): Promise<ToolInvocationCompletionResult>
	{
		return this._execute(async function _completeSuccess(_repository, _transaction, participant)
		{
			return participant.completeSucceeded(claim, result, now);
		});
	}

	/** Record failure, its result delivery, and the failure event in one transaction. */
	async completeFailed(claim: ToolInvocationClaim, failureCode: string, now: Date): Promise<ToolInvocationCompletionResult>
	{
		return this._execute(async function _completeFailure(_repository, _transaction, participant)
		{
			return participant.completeFailed(claim, failureCode, now);
		});
	}

	/** Apply ambiguous recovery policy and append its safe lifecycle event atomically. */
	async completeAmbiguous(claim: ToolInvocationClaim, now: Date): Promise<ToolInvocationRecord | null>
	{
		return this._execute(async function _completeAmbiguous(_repository, _transaction, participant)
		{
			return participant.completeAmbiguous(claim, now);
		});
	}

	/** Release an exact pre-dispatch claim and append its safe failure status atomically. */
	async releaseClaimBeforeDispatch(claim: ToolInvocationClaim, now: Date): Promise<ToolInvocationRecord | null>
	{
		const lifecycleEvents = this._lifecycleEvents;
		const recoveryEvents = this._recoveryEvents;
		const runRecovery = this._runRecovery;
		return this._execute(async function _releaseClaim(repository, transaction)
		{
			const transition = await repository.releaseClaimBeforeDispatch(claim, now);
			if (!transition.changed || transition.invocation === null) return transition.invocation;
			const invocation = transition.invocation;
			const retrying = invocation.state === ToolInvocationStates.Ready || invocation.state === ToolInvocationStates.Reconciling;
			await _appendLifecycleEvent(lifecycleEvents, transaction, _failedEvent(invocation, _START_EVENT_FAILURE_CODE, retrying, TOOL_INVOCATION_PREPARATION_POLICY.attemptLimit));
			if (invocation.state === ToolInvocationStates.RecoveryRequired) await _enterRecoveryRequired(runRecovery, recoveryEvents, transaction, invocation);
			return invocation;
		});
	}

	/** Recover one expired claim under frozen provider capability without repeating its effect. */
	async recoverExpiredClaim(invocationId: string, now: Date): Promise<ToolInvocationRecord | null>
	{
		const lifecycleEvents = this._lifecycleEvents;
		const recoveryEvents = this._recoveryEvents;
		const runRecovery = this._runRecovery;
		return this._execute(async function _recoverExpiredClaim(repository, transaction)
		{
			const transition = await repository.recoverExpiredClaim(invocationId, now);
			if (!transition.changed || transition.invocation === null) return transition.invocation;
			const invocation = transition.invocation;
			const retrying = invocation.state === ToolInvocationStates.Ready || invocation.state === ToolInvocationStates.Reconciling;
			await _appendLifecycleEvent(lifecycleEvents, transaction, _failedEvent(invocation, _EXPIRED_CLAIM_FAILURE_CODE, retrying, TOOL_INVOCATION_PREPARATION_POLICY.attemptLimit));
			if (invocation.state === ToolInvocationStates.RecoveryRequired) await _enterRecoveryRequired(runRecovery, recoveryEvents, transaction, invocation);
			return invocation;
		});
	}

	/** Execute one operation against exactly one transaction-scoped repository instance. */
	private async _execute<TResult>(operation: (repository: PrismaToolInvocationRepository, transaction: Prisma.TransactionClient, participant: PrismaMcpToolInvocationParticipantUnitOfWork) => Promise<TResult>): Promise<TResult>
	{
		const lifecycleEvents = this._lifecycleEvents;
		const recoveryEvents = this._recoveryEvents;
		const runRecovery = this._runRecovery;
		return this._prisma.$transaction(async function _transaction(transaction): Promise<TResult>
		{
			const repository = new PrismaToolInvocationRepository(transaction);
			const participant = new PrismaMcpToolInvocationParticipantUnitOfWork(transaction, lifecycleEvents, recoveryEvents, runRecovery);
			return operation(repository, transaction, participant);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}

/** Build one secret-free canonical failure or retry event. */
function _failedEvent(invocation: ToolInvocationRecord, reason: string, retrying: boolean, retryLimit: number): ToolInvocationLifecycleEvent
{
	return { runId: invocation.runId, attempt: invocation.attempt, eventType: ToolInvocationEventTypes.Failed, payload: { toolInvocationId: invocation.toolInvocationId, toolRevisionId: invocation.toolRevisionId, reason, retryCount: invocation.preparationAttempt, retryLimit, retrying } };
}

/** Append the timeline entry, and throw if the run refuses it — that rolls back the state change too, so a transition can never happen invisibly. */
async function _appendLifecycleEvent(sink: ToolInvocationLifecycleEventSink, transaction: Prisma.TransactionClient, event: ToolInvocationLifecycleEvent): Promise<void>
{
	if (!await sink.appendInTransaction(transaction, event)) throw new Error("tool invocation transition requires its canonical lifecycle event");
}

/** Append the "a person must decide this" entry, and throw if the run refuses it, so a tool call can never reach `RecoveryRequired` unnoticed. */
async function _appendRecoveryEvent(sink: ToolInvocationRecoveryEventSink, transaction: Prisma.TransactionClient, invocation: ToolInvocationRecord): Promise<void>
{
	const event: ToolInvocationRecoveryEvent = { runId: invocation.runId, expectedAttempt: invocation.attempt, toolInvocationId: invocation.toolInvocationId, preparationRetryCount: invocation.preparationAttempt, preparationRetryLimit: TOOL_INVOCATION_PREPARATION_POLICY.attemptLimit, providerOutcome: "unknown_after_dispatch" };
	if (!await sink.appendInTransaction(transaction, event)) throw new Error("tool recovery state requires its canonical recovery event");
}

/** Move the run into manual recovery and record it, in the same transaction as the tool call's change. See the comment inside for why a cancelling run is the one case that records nothing. */
async function _enterRecoveryRequired(authority: ToolInvocationRunRecoveryAuthority, sink: ToolInvocationRecoveryEventSink, transaction: Prisma.TransactionClient, invocation: ToolInvocationRecord): Promise<void>
{
	const outcome = await authority.enterRecoveryRequiredInTransaction(transaction, { runId: invocation.runId, attempt: invocation.attempt });
	// Cancelling is the only valid outcome that suppresses the recovery event. The invocation's
	// claim-clearing evidence still commits so cancellation can finish without repeating provider I/O.
	if (outcome === ToolInvocationRunRecoveryEnterResults.Cancelling) return;
	if (outcome === ToolInvocationRunRecoveryEnterResults.Conflict) throw new Error("tool recovery state conflicts with its owning run attempt");
	await _appendRecoveryEvent(sink, transaction, invocation);
}
