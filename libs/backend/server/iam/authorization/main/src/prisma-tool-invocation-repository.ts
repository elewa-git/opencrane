import { ExternalActionClaimKind, ExternalActionRecoveryMode, Prisma, ToolInvocationState, ToolResultDeliveryState } from "@prisma/client";

import type { JsonValue } from "@opencrane/util";

import { __DigestCanonicalJson } from "./canonical-json-digest.js";
import { __PlanToolInvocationLifecycle } from "./tool-invocation-lifecycle.js";
import { ExternalActionClaimKinds, ExternalActionRecoveryModes, TOOL_INVOCATION_PREPARATION_POLICY, ToolInvocationLifecycleActions, ToolInvocationLifecycleEvents, ToolInvocationStates } from "./tool-invocation-lifecycle.types.js";
import type { ToolInvocationAdmissionResult, ToolInvocationClaim, ToolInvocationClaimResult, ToolInvocationCompletionResult, ToolInvocationIntent, ToolInvocationPreparationPolicy, ToolInvocationRecord, ToolInvocationTransactionRepository, ToolInvocationTransitionResult, ToolResultDeliveryPayload } from "./tool-invocation.types.js";

/** Convert Prisma's ToolInvocationState values into this package's own state enum. */
const _STATE_FROM_PRISMA: Readonly<Record<ToolInvocationState, ToolInvocationStates>> = {
	[ToolInvocationState.Preparing]: ToolInvocationStates.Preparing,
	[ToolInvocationState.AwaitingApproval]: ToolInvocationStates.AwaitingApproval,
	[ToolInvocationState.Ready]: ToolInvocationStates.Ready,
	[ToolInvocationState.Claimed]: ToolInvocationStates.Claimed,
	[ToolInvocationState.Reconciling]: ToolInvocationStates.Reconciling,
	[ToolInvocationState.Succeeded]: ToolInvocationStates.Succeeded,
	[ToolInvocationState.Failed]: ToolInvocationStates.Failed,
	[ToolInvocationState.RecoveryRequired]: ToolInvocationStates.RecoveryRequired,
};

/** Map our recovery modes onto Prisma's generated enum. */
const _RECOVERY_TO_PRISMA: Readonly<Record<ExternalActionRecoveryModes, ExternalActionRecoveryMode>> = {
	[ExternalActionRecoveryModes.ProviderIdempotency]: ExternalActionRecoveryMode.ProviderIdempotency,
	[ExternalActionRecoveryModes.Reconciliation]: ExternalActionRecoveryMode.Reconciliation,
	[ExternalActionRecoveryModes.Manual]: ExternalActionRecoveryMode.Manual,
};

/** Convert a stored recovery-mode name back into this package's enum. */
const _RECOVERY_FROM_PRISMA: Readonly<Record<ExternalActionRecoveryMode, ExternalActionRecoveryModes>> = {
	[ExternalActionRecoveryMode.ProviderIdempotency]: ExternalActionRecoveryModes.ProviderIdempotency,
	[ExternalActionRecoveryMode.Reconciliation]: ExternalActionRecoveryModes.Reconciliation,
	[ExternalActionRecoveryMode.Manual]: ExternalActionRecoveryModes.Manual,
};

/** Convert this package's claim-kind enum into the name stored in the database. */
const _CLAIM_TO_PRISMA: Readonly<Record<ExternalActionClaimKinds, ExternalActionClaimKind>> = {
	[ExternalActionClaimKinds.Dispatch]: ExternalActionClaimKind.Dispatch,
	[ExternalActionClaimKinds.Reconcile]: ExternalActionClaimKind.Reconcile,
};

/** Smallest persistence row shape the row-to-record helper accepts. */
type ToolInvocationRow = Prisma.ToolInvocationGetPayload<Record<string, never>>;

/** Map a persisted claim kind back to the dependency-light vocabulary. */
function _claimKind(kind: ExternalActionClaimKind | null): ExternalActionClaimKinds | null
{
	if (kind === null) return null;
	return kind === ExternalActionClaimKind.Dispatch ? ExternalActionClaimKinds.Dispatch : ExternalActionClaimKinds.Reconcile;
}

/** Convert one ToolInvocation row into ToolInvocationRecord, so Prisma's generated types stay in this file. */
function _record(row: ToolInvocationRow): ToolInvocationRecord
{
	return {
		id: row.id,
		siloId: row.siloId,
		agentRevisionId: row.agentRevisionId,
		subjectId: row.subjectId,
		runId: row.runId,
		attempt: row.attempt,
		candidateId: row.candidateId,
		toolInvocationId: row.toolInvocationId,
		toolRevisionId: row.toolRevisionId,
		arguments: row.arguments as unknown as JsonValue,
		argumentsDigest: row.argumentsDigest,
		effectiveArguments: row.effectiveArguments as unknown as JsonValue,
		effectiveArgumentsDigest: row.effectiveArgumentsDigest,
		requestFingerprint: row.requestFingerprint,
		approvalRequired: row.approvalRequired,
		recoveryMode: _RECOVERY_FROM_PRISMA[row.recoveryMode],
		recoveryKey: row.recoveryKey,
		state: _STATE_FROM_PRISMA[row.state],
		preparationAttempt: row.preparationAttempt,
		retryDeadlineAt: row.retryDeadlineAt,
		nextPreparationAttemptAt: row.nextPreparationAttemptAt,
		claimAttempt: row.claimAttempt,
		claimKind: _claimKind(row.claimKind),
		claimFence: row.claimFence,
		claimExpiresAt: row.claimExpiresAt,
		result: row.result as unknown as JsonValue | null,
		failureCode: row.failureCode,
		revision: row.revision,
	};
}

/** Validate the immutable provider recovery key contract before persistence. */
function _recoveryKeyIsValid(intent: ToolInvocationIntent): boolean
{
	if (intent.recoveryMode === ExternalActionRecoveryModes.Manual) return intent.recoveryKey === null;
	return typeof intent.recoveryKey === "string" && intent.recoveryKey.length > 0 && intent.recoveryKey.length <= 256;
}

/** Require every caller to use the one approved provider-free preparation policy. */
function _isFixedPreparationPolicy(policy: ToolInvocationPreparationPolicy): boolean
{
	return policy.attemptLimit === TOOL_INVOCATION_PREPARATION_POLICY.attemptLimit
		&& policy.retryWindowMilliseconds === TOOL_INVOCATION_PREPARATION_POLICY.retryWindowMilliseconds
		&& policy.retryDelayMilliseconds === TOOL_INVOCATION_PREPARATION_POLICY.retryDelayMilliseconds;
}

/** Return the exact persistence state owned by one claim kind. */
function _claimedState(kind: ExternalActionClaimKinds): ToolInvocationState
{
	return kind === ExternalActionClaimKinds.Dispatch ? ToolInvocationState.Claimed : ToolInvocationState.Reconciling;
}

/** Convert a nullable canonical result into Prisma's explicit JSON-null vocabulary. */
function _resultInput(result: JsonValue): Prisma.InputJsonValue | typeof Prisma.JsonNull
{
	return result === null ? Prisma.JsonNull : result as Prisma.InputJsonValue;
}

/** Restrict durable failure codes to bounded, non-secret machine categories. */
function _safeFailureCode(failureCode: string): string
{
	return /^[a-z][a-z0-9_]{0,63}$/.test(failureCode) ? failureCode : "external_action_failed";
}

/** Ask the lifecycle table which database change this row's state allows for this event. */
function _plan(row: ToolInvocationRow, event: ToolInvocationLifecycleEvents, now: Date): ToolInvocationLifecycleActions
{
	return __PlanToolInvocationLifecycle({
		state: _STATE_FROM_PRISMA[row.state],
		event,
		recoveryMode: _RECOVERY_FROM_PRISMA[row.recoveryMode],
		claimKind: _claimKind(row.claimKind),
		preparationAttempt: row.preparationAttempt,
		preparationAttemptLimit: TOOL_INVOCATION_PREPARATION_POLICY.attemptLimit,
		withinPreparationDeadline: row.retryDeadlineAt.getTime() > now.getTime(),
	});
}

/** Map a planner-owned action onto its sole durable target state. */
function _targetState(action: ToolInvocationLifecycleActions): ToolInvocationState | null
{
	if (action === ToolInvocationLifecycleActions.MarkReady || action === ToolInvocationLifecycleActions.Approve || action === ToolInvocationLifecycleActions.Redispatch || action === ToolInvocationLifecycleActions.RedispatchIdempotently) return ToolInvocationState.Ready;
	if (action === ToolInvocationLifecycleActions.AwaitApproval) return ToolInvocationState.AwaitingApproval;
	if (action === ToolInvocationLifecycleActions.RetryPreparation) return ToolInvocationState.Preparing;
	if (action === ToolInvocationLifecycleActions.ClaimDispatch) return ToolInvocationState.Claimed;
	if (action === ToolInvocationLifecycleActions.BeginReconciliation || action === ToolInvocationLifecycleActions.ClaimReconciliation || action === ToolInvocationLifecycleActions.RetryReconciliation) return ToolInvocationState.Reconciling;
	if (action === ToolInvocationLifecycleActions.Succeed) return ToolInvocationState.Succeeded;
	if (action === ToolInvocationLifecycleActions.Fail) return ToolInvocationState.Failed;
	if (action === ToolInvocationLifecycleActions.RequireManualRecovery) return ToolInvocationState.RecoveryRequired;
	return null;
}

/** Select the exact planner event for one claimed provider completion. */
function _completionEvent(kind: ExternalActionClaimKinds, outcome: ToolResultDeliveryPayload["outcome"]): ToolInvocationLifecycleEvents
{
	if (kind === ExternalActionClaimKinds.Dispatch && outcome === "succeeded") return ToolInvocationLifecycleEvents.DispatchSucceeded;
	if (kind === ExternalActionClaimKinds.Dispatch) return ToolInvocationLifecycleEvents.DispatchRejected;
	if (outcome === "succeeded") return ToolInvocationLifecycleEvents.ReconcileSucceeded;
	return ToolInvocationLifecycleEvents.ReconcileFailed;
}

/**
 * Every tool-call write, on one open transaction.
 *
 * Two rules hold for each method here. It asks {@link __PlanToolInvocationLifecycle} what is
 * allowed BEFORE writing and never invents a transition of its own. And it puts its optimistic
 * check in the update's WHERE clause — the expected `revision`, or the exact claim `fence`, plus
 * the owning run's attempt and state — so a stale worker's write simply matches no row instead of
 * overwriting a newer one. After every attempt it re-reads the row and returns what actually
 * stands.
 *
 * The `static *InTransaction` methods exist so other files in this package (approval decisions,
 * candidate admission) can perform one of these writes inside a transaction they already own,
 * without constructing an instance.
 * @see {@link ToolInvocationTransactionRepository}
 */
export class PrismaToolInvocationRepository implements ToolInvocationTransactionRepository
{
	/** The transaction every query in this class runs on. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind all reads and writes to one ToolInvocation unit-of-work transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Admit one external-action candidate as durable Preparing work. */
	async admit(intent: ToolInvocationIntent, now: Date, policy: ToolInvocationPreparationPolicy): Promise<ToolInvocationAdmissionResult>
	{
		return PrismaToolInvocationRepository.admitInTransaction(this._transaction, intent, now, policy);
	}

	/** Admit one candidate inside an existing caller-owned serializable transaction. */
	static async admitInTransaction(transaction: Prisma.TransactionClient, intent: ToolInvocationIntent, now: Date, policy: ToolInvocationPreparationPolicy): Promise<ToolInvocationAdmissionResult>
	{
		if (!_recoveryKeyIsValid(intent) || !_isFixedPreparationPolicy(policy)) return { outcome: "conflict" };
		const key = { runId: intent.runId, attempt: intent.attempt, candidateId: intent.requestIdentity.candidateId };
		const existing = await transaction.toolInvocation.findUnique({ where: { runId_attempt_candidateId: key } });
		if (existing !== null) return existing.requestFingerprint === intent.requestFingerprint ? { outcome: "idempotent", invocation: _record(existing) } : { outcome: "conflict" };
		const fingerprintOwner = await transaction.toolInvocation.findUnique({ where: { requestFingerprint: intent.requestFingerprint } });
		if (fingerprintOwner !== null) return { outcome: "conflict" };
		const created = await transaction.toolInvocation.create({
			data: {
				siloId: intent.siloId,
				runId: intent.runId,
				attempt: intent.attempt,
				agentServiceId: intent.agentServiceId,
				agentRevisionId: intent.agentRevisionId,
				subjectId: intent.subjectId,
				runtimeInstanceId: intent.requestIdentity.runtimeInstanceId,
				commandId: intent.requestIdentity.commandId,
				candidateId: intent.requestIdentity.candidateId,
				toolRevisionId: intent.toolRevisionId,
				toolInvocationId: intent.toolInvocationId,
				arguments: intent.arguments as Prisma.InputJsonValue,
				argumentsDigest: intent.argumentsDigest,
				effectiveArguments: intent.arguments as Prisma.InputJsonValue,
				effectiveArgumentsDigest: intent.argumentsDigest,
				requestFingerprint: intent.requestFingerprint,
				requestIdentity: intent.requestIdentity as unknown as Prisma.InputJsonValue,
				approvalRequired: intent.approvalRequired,
				recoveryMode: _RECOVERY_TO_PRISMA[intent.recoveryMode],
				recoveryKey: intent.recoveryKey,
				retryDeadlineAt: new Date(now.getTime() + policy.retryWindowMilliseconds),
				nextPreparationAttemptAt: now,
			},
		});
		return { outcome: "admitted", invocation: _record(created) };
	}

	/** Load one invocation by its trusted database identity. */
	async findById(invocationId: string): Promise<ToolInvocationRecord | null>
	{
		return PrismaToolInvocationRepository.findByIdInTransaction(this._transaction, invocationId);
	}

	/** Load one ToolInvocation inside an existing caller-owned transaction. */
	static async findByIdInTransaction(transaction: Prisma.TransactionClient, invocationId: string): Promise<ToolInvocationRecord | null>
	{
		const row = await transaction.toolInvocation.findUnique({ where: { id: invocationId } });
		return row === null ? null : _record(row);
	}

	/** Load one invocation from its accepted candidate coordinates. */
	async findByCandidate(runId: string, attempt: number, candidateId: string): Promise<ToolInvocationRecord | null>
	{
		const row = await this._transaction.toolInvocation.findUnique({ where: { runId_attempt_candidateId: { runId, attempt, candidateId } } });
		return row === null ? null : _record(row);
	}

	/** Return the oldest runnable invocation whose owning run attempt remains dispatchable. */
	async findNextRunnable(now: Date): Promise<ToolInvocationRecord | null>
	{
		const rows = await this._transaction.toolInvocation.findMany({
			where: {
				OR: [
					{
						run: { is: { state: "Running" } },
						OR: [
							{ state: ToolInvocationState.Preparing, nextPreparationAttemptAt: { lte: now } },
							{ state: ToolInvocationState.AwaitingApproval, claimKind: null },
							{ state: ToolInvocationState.Ready, claimKind: null, claimExpiresAt: null },
							{ state: ToolInvocationState.Reconciling, claimKind: null, claimExpiresAt: null },
							{ state: { in: [ToolInvocationState.Claimed, ToolInvocationState.Reconciling] }, claimKind: { not: null }, claimExpiresAt: { lte: now } },
						],
					},
					{ run: { is: { state: "Cancelling" } }, state: { in: [ToolInvocationState.Claimed, ToolInvocationState.Reconciling] }, claimKind: { not: null }, claimExpiresAt: { lte: now } },
				],
			},
			include: { run: { select: { attempt: true } } },
			orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
		});
		const current = rows.find(function _currentAttempt(row) { return row.attempt === row.run.attempt; });
		return current === undefined ? null : _record(current);
	}

	/** Record provider-free preparation success and select approval or dispatch readiness. */
	async markPrepared(invocationId: string, expectedRevision: number, now: Date): Promise<ToolInvocationRecord | null>
	{
		const invocation = await this._transaction.toolInvocation.findUnique({ where: { id: invocationId } });
		if (invocation === null) return null;
		const event = invocation.approvalRequired ? ToolInvocationLifecycleEvents.PreparedForApproval : ToolInvocationLifecycleEvents.Prepared;
		const state = _targetState(_plan(invocation, event, now));
		if (state === null) return _record(invocation);
		await this._transaction.toolInvocation.updateMany({
			where: { id: invocationId, state: ToolInvocationState.Preparing, revision: expectedRevision, run: { is: { attempt: invocation.attempt, state: "Running" } } },
			data: { state, preparationAttempt: { increment: 1 }, failureCode: null, nextPreparationAttemptAt: now, revision: { increment: 1 } },
		});
		return this._winner(invocationId);
	}

	/** Consume one provider-free preparation failure under the three-in-five-minutes policy. */
	async recordPreparationFailure(invocationId: string, expectedRevision: number, now: Date, policy: ToolInvocationPreparationPolicy, failureCode: string): Promise<ToolInvocationTransitionResult>
	{
		const invocation = await this._transaction.toolInvocation.findUnique({ where: { id: invocationId } });
		if (invocation === null) return { changed: false, invocation: null };
		if (!_isFixedPreparationPolicy(policy)) return { changed: false, invocation: _record(invocation) };
		const action = __PlanToolInvocationLifecycle({ state: _STATE_FROM_PRISMA[invocation.state], event: ToolInvocationLifecycleEvents.PreparationFailed, recoveryMode: _RECOVERY_FROM_PRISMA[invocation.recoveryMode], claimKind: _claimKind(invocation.claimKind), preparationAttempt: invocation.preparationAttempt, preparationAttemptLimit: policy.attemptLimit, withinPreparationDeadline: invocation.retryDeadlineAt.getTime() > now.getTime() });
		const state = _targetState(action);
		if (state !== ToolInvocationState.Preparing && state !== ToolInvocationState.Failed) return { changed: false, invocation: _record(invocation) };
		const safeFailureCode = _safeFailureCode(failureCode);
		const updated = await this._transaction.toolInvocation.updateMany({
			where: { id: invocationId, state: ToolInvocationState.Preparing, revision: expectedRevision, run: { is: { attempt: invocation.attempt, state: "Running" } } },
			data: state === ToolInvocationState.Failed
				? { state, preparationAttempt: { increment: 1 }, failureCode: safeFailureCode, completedAt: now, revision: { increment: 1 } }
				: { preparationAttempt: { increment: 1 }, failureCode: safeFailureCode, nextPreparationAttemptAt: new Date(now.getTime() + policy.retryDelayMilliseconds), revision: { increment: 1 } },
		});
		if (updated.count === 1 && state === ToolInvocationState.Failed) await this._createDelivery(invocationId, { toolInvocationId: invocation.toolInvocationId, outcome: "failed", failureCode: safeFailureCode }, now);
		return { changed: updated.count === 1, invocation: await this._winner(invocationId) };
	}

	/** Move one exact authenticated approval to Ready with its effective arguments. */
	async markApproved(invocationId: string, expectedArguments: JsonValue, expectedArgumentsDigest: string, effectiveArguments: JsonValue, effectiveArgumentsDigest: string): Promise<boolean>
	{
		return PrismaToolInvocationRepository.markApprovedInTransaction(this._transaction, invocationId, expectedArguments, expectedArgumentsDigest, effectiveArguments, effectiveArgumentsDigest);
	}

	/** Apply approved effective arguments inside an existing approval transaction. */
	static async markApprovedInTransaction(transaction: Prisma.TransactionClient, invocationId: string, expectedArguments: JsonValue, expectedArgumentsDigest: string, effectiveArguments: JsonValue, effectiveArgumentsDigest: string): Promise<boolean>
	{
		const invocation = await transaction.toolInvocation.findUnique({ where: { id: invocationId } });
		if (invocation === null || __DigestCanonicalJson(invocation.arguments as JsonValue) !== __DigestCanonicalJson(expectedArguments)) return false;
		if (_plan(invocation, ToolInvocationLifecycleEvents.Approved, invocation.createdAt) !== ToolInvocationLifecycleActions.Approve) return false;
		const updated = await transaction.toolInvocation.updateMany({
			where: { id: invocationId, state: ToolInvocationState.AwaitingApproval, argumentsDigest: expectedArgumentsDigest, revision: invocation.revision, run: { is: { attempt: invocation.attempt, state: "WaitingForInput" } } },
			data: { state: ToolInvocationState.Ready, effectiveArguments: effectiveArguments as Prisma.InputJsonValue, effectiveArgumentsDigest, failureCode: null, revision: { increment: 1 } },
		});
		return updated.count === 1;
	}

	/** Terminalise rejected approval and create the exact failure delivery. */
	async markApprovalRejected(invocationId: string, now: Date, failureCode: string): Promise<boolean>
	{
		return PrismaToolInvocationRepository.markApprovalRejectedInTransaction(this._transaction, invocationId, now, failureCode);
	}

	/** Terminalise rejected approval inside an existing approval transaction. */
	static async markApprovalRejectedInTransaction(transaction: Prisma.TransactionClient, invocationId: string, now: Date, failureCode: string): Promise<boolean>
	{
		const invocation = await transaction.toolInvocation.findUnique({ where: { id: invocationId } });
		if (invocation === null) return false;
		if (_plan(invocation, ToolInvocationLifecycleEvents.ApprovalRejected, now) !== ToolInvocationLifecycleActions.Fail) return false;
		const safeFailureCode = _safeFailureCode(failureCode);
		const updated = await transaction.toolInvocation.updateMany({
			where: { id: invocationId, state: ToolInvocationState.AwaitingApproval, revision: invocation.revision, run: { is: { attempt: invocation.attempt, state: "WaitingForInput" } } },
			data: { state: ToolInvocationState.Failed, failureCode: safeFailureCode, completedAt: now, revision: { increment: 1 } },
		});
		if (updated.count !== 1) return false;
		const payload = { toolInvocationId: invocation.toolInvocationId, outcome: "failed", failureCode: safeFailureCode } as const;
		await transaction.toolResultDelivery.create({ data: { toolInvocationId: invocationId, state: ToolResultDeliveryState.Pending, payload, payloadDigest: __DigestCanonicalJson(payload), createdAt: now } });
		return true;
	}

	/** Acquire a monotonic provider operation claim without stealing a live lease. */
	async claim(invocationId: string, kind: ExternalActionClaimKinds, now: Date, leaseMilliseconds: number): Promise<ToolInvocationClaimResult>
	{
		const current = await this._transaction.toolInvocation.findUnique({ where: { id: invocationId } });
		if (current === null) return { outcome: "missing" };
		const event = kind === ExternalActionClaimKinds.Dispatch ? ToolInvocationLifecycleEvents.DispatchClaimed : ToolInvocationLifecycleEvents.ReconcileClaimed;
		const action = _plan(current, event, now);
		const expectedAction = kind === ExternalActionClaimKinds.Dispatch ? ToolInvocationLifecycleActions.ClaimDispatch : ToolInvocationLifecycleActions.ClaimReconciliation;
		if (action !== expectedAction) return { outcome: "winner", invocation: _record(current) };
		const expectedState = current.state;
		const nextFence = current.claimFence + 1;
		const updated = await this._transaction.toolInvocation.updateMany({
			where: { id: invocationId, state: expectedState, revision: current.revision, claimKind: null, claimExpiresAt: null, run: { is: { attempt: current.attempt, state: "Running" } } },
			data: { state: _claimedState(kind), claimAttempt: { increment: 1 }, claimKind: _CLAIM_TO_PRISMA[kind], claimFence: nextFence, claimExpiresAt: new Date(now.getTime() + leaseMilliseconds), revision: { increment: 1 } },
		});
		const winner = await this._winner(invocationId);
		if (winner === null) return { outcome: "missing" };
		if (updated.count !== 1) return { outcome: "winner", invocation: winner };
		return { outcome: "claimed", claim: { invocationId, kind, fence: nextFence, revision: winner.revision }, invocation: winner };
	}

	/** Complete one exact claim and create its one-to-one result delivery. */
	async complete(claim: ToolInvocationClaim, payload: ToolResultDeliveryPayload, now: Date): Promise<ToolInvocationCompletionResult>
	{
		const safePayload = payload.outcome === "succeeded" ? payload : { ...payload, failureCode: _safeFailureCode(payload.failureCode) };
		const result = safePayload.outcome === "succeeded" ? _resultInput(safePayload.result) : Prisma.DbNull;
		const failureCode = safePayload.outcome === "failed" ? safePayload.failureCode : null;
		const before = await this._transaction.toolInvocation.findUnique({ where: { id: claim.invocationId } });
		if (before === null) return { outcome: "missing" };
		const event = _completionEvent(claim.kind, safePayload.outcome);
		const state = _targetState(_plan(before, event, now));
		if (state !== ToolInvocationState.Succeeded && state !== ToolInvocationState.Failed) return { outcome: "winner", invocation: _record(before) };
		const updated = await this._transaction.toolInvocation.updateMany({
			where: { id: claim.invocationId, state: _claimedState(claim.kind), claimKind: _CLAIM_TO_PRISMA[claim.kind], claimFence: claim.fence, revision: claim.revision, run: { is: { attempt: before.attempt, state: { in: ["Running", "Cancelling"] } } } },
			data: { state, result, failureCode, claimKind: null, claimExpiresAt: null, completedAt: now, revision: { increment: 1 } },
		});
		const winner = await this._winner(claim.invocationId);
		if (winner === null) return { outcome: "missing" };
		if (updated.count !== 1) return { outcome: "winner", invocation: winner };
		await this._createDelivery(claim.invocationId, safePayload, now);
		return { outcome: "completed", invocation: await this._requiredWinner(claim.invocationId), delivery: safePayload };
	}

	/** Apply the frozen recovery strategy after one exact ambiguous provider operation. */
	async completeAmbiguous(claim: ToolInvocationClaim, now: Date): Promise<ToolInvocationTransitionResult>
	{
		const invocation = await this._transaction.toolInvocation.findUnique({ where: { id: claim.invocationId } });
		if (invocation === null) return { changed: false, invocation: null };
		const event = claim.kind === ExternalActionClaimKinds.Dispatch ? ToolInvocationLifecycleEvents.DispatchAmbiguous : ToolInvocationLifecycleEvents.ReconcileInconclusive;
		const target = _targetState(_plan(invocation, event, now));
		if (target === null) return { changed: false, invocation: _record(invocation) };
		const updated = await this._transaction.toolInvocation.updateMany({
			where: { id: claim.invocationId, state: _claimedState(claim.kind), claimKind: _CLAIM_TO_PRISMA[claim.kind], claimFence: claim.fence, revision: claim.revision, run: { is: { attempt: invocation.attempt, state: { in: ["Running", "Cancelling"] } } } },
			data: { state: target, recoveryRequiredAt: target === ToolInvocationState.RecoveryRequired ? now : null, claimKind: null, claimExpiresAt: null, revision: { increment: 1 } },
		});
		return { changed: updated.count === 1, invocation: await this._winner(claim.invocationId) };
	}

	/** Release an exact claim after the worker proves no provider request started. */
	async releaseClaimBeforeDispatch(claim: ToolInvocationClaim, now: Date): Promise<ToolInvocationTransitionResult>
	{
		const invocation = await this._transaction.toolInvocation.findUnique({ where: { id: claim.invocationId } });
		if (invocation === null) return { changed: false, invocation: null };
		const event = claim.kind === ExternalActionClaimKinds.Dispatch ? ToolInvocationLifecycleEvents.DispatchProvenNotStarted : ToolInvocationLifecycleEvents.ReconcileProvenNotStarted;
		const target = _targetState(_plan(invocation, event, now));
		if (target === null) return { changed: false, invocation: _record(invocation) };
		const recoveryRequiredAt = target === ToolInvocationState.RecoveryRequired ? now : null;
		const completedAt = target === ToolInvocationState.Failed ? now : null;
		const updated = await this._transaction.toolInvocation.updateMany({
			where: { id: claim.invocationId, state: _claimedState(claim.kind), claimKind: _CLAIM_TO_PRISMA[claim.kind], claimFence: claim.fence, revision: claim.revision, run: { is: { attempt: invocation.attempt, state: { in: ["Running", "Cancelling"] } } } },
			data: { state: target, preparationAttempt: { increment: 1 }, failureCode: "external_action_start_event_failed", nextPreparationAttemptAt: now, recoveryRequiredAt, claimKind: null, claimExpiresAt: null, completedAt, revision: { increment: 1 } },
		});
		if (updated.count === 1 && target === ToolInvocationState.Failed) await this._createDelivery(claim.invocationId, { toolInvocationId: invocation.toolInvocationId, outcome: "failed", failureCode: "external_action_start_event_failed" }, now);
		return { changed: updated.count === 1, invocation: await this._winner(claim.invocationId) };
	}

	/** Apply the frozen strategy to one expired provider claim without repeating its effect. */
	async recoverExpiredClaim(invocationId: string, now: Date): Promise<ToolInvocationTransitionResult>
	{
		const invocation = await this._transaction.toolInvocation.findUnique({ where: { id: invocationId } });
		if (invocation === null || invocation.claimKind === null || invocation.claimExpiresAt === null || invocation.claimExpiresAt.getTime() > now.getTime()) return { changed: false, invocation: invocation === null ? null : _record(invocation) };
		const event = invocation.claimKind === ExternalActionClaimKind.Dispatch ? ToolInvocationLifecycleEvents.DispatchClaimExpired : ToolInvocationLifecycleEvents.ReconcileClaimExpired;
		const target = _targetState(_plan(invocation, event, now));
		if (target === null) return { changed: false, invocation: _record(invocation) };
		const updated = await this._transaction.toolInvocation.updateMany({
			where: { id: invocationId, state: invocation.state, claimKind: invocation.claimKind, claimFence: invocation.claimFence, claimExpiresAt: { lte: now }, revision: invocation.revision, run: { is: { attempt: invocation.attempt, state: { in: ["Running", "Cancelling"] } } } },
			data: { state: target, recoveryRequiredAt: target === ToolInvocationState.RecoveryRequired ? now : null, claimKind: null, claimExpiresAt: null, revision: { increment: 1 } },
		});
		return { changed: updated.count === 1, invocation: await this._winner(invocationId) };
	}

	/** Re-read the row after a conditional update, whether or not this call was the one that changed it. */
	private async _winner(invocationId: string): Promise<ToolInvocationRecord | null>
	{
		const winner = await this._transaction.toolInvocation.findUnique({ where: { id: invocationId } });
		return winner === null ? null : _record(winner);
	}

	/** Re-read the row after a write that succeeded, so it must still exist; throws if it does not. */
	private async _requiredWinner(invocationId: string): Promise<ToolInvocationRecord>
	{
		const winner = await this._winner(invocationId);
		if (winner === null) throw new Error("tool invocation disappeared after a successful transition");
		return winner;
	}

	/** Persist one exact delivery payload with its canonical digest. */
	private async _createDelivery(invocationId: string, payload: ToolResultDeliveryPayload, now: Date): Promise<void>
	{
		await this._transaction.toolResultDelivery.create({ data: { toolInvocationId: invocationId, state: ToolResultDeliveryState.Pending, payload: payload as unknown as Prisma.InputJsonValue, payloadDigest: __DigestCanonicalJson(payload as unknown as JsonValue), createdAt: now } });
	}

}

/**
 * Record one accepted tool-call candidate as a new invocation, in the caller's transaction.
 *
 * Exported as a plain function so the runtime-dispatch code can admit an invocation without
 * importing this class. Idempotent on `(runId, attempt, candidateId)`.
 *
 * Called by: libs/backend/agents/execution/protocol/src/prisma-runtime-dispatch-authority.ts.
 * @param transaction - Transaction already accepting the runtime candidate.
 * @param intent - Frozen candidate facts.
 * @param now - Trusted server time; sets the retry deadline.
 * @param policy - Must be exactly {@link TOOL_INVOCATION_PREPARATION_POLICY}, or the result is
 *   `conflict`.
 * @returns `admitted`, `idempotent`, or a permanent `conflict`. See
 *   {@link ToolInvocationAdmissionResult}.
 */
export async function __AdmitPreparingToolInvocationInTransaction(transaction: Prisma.TransactionClient, intent: ToolInvocationIntent, now: Date, policy: ToolInvocationPreparationPolicy): Promise<ToolInvocationAdmissionResult>
{
	return PrismaToolInvocationRepository.admitInTransaction(transaction, intent, now, policy);
}

/**
 * Read one tool call by database id, using the caller's transaction.
 *
 * Called by: ./deferred-tool-approval.ts and ./prisma-deferred-tool-approval-opener.ts, which need
 * the row inside the transaction that is deciding an approval.
 * @returns The stored row, or null when it does not exist. Callers must also re-check that the
 *   row's run, attempt, tool revision, and arguments digest match the approval.
 */
export async function __FindToolInvocationInTransaction(transaction: Prisma.TransactionClient, invocationId: string): Promise<ToolInvocationRecord | null>
{
	return PrismaToolInvocationRepository.findByIdInTransaction(transaction, invocationId);
}

/**
 * Move one approved tool call to `Ready` with the reviewer's arguments.
 *
 * Called by: ./deferred-tool-approval.ts (`__DecideDeferredToolRequest`).
 * @returns True when applied. False means the tool call was no longer awaiting approval on a
 *   waiting run, or its stored arguments did not match what the reviewer was shown — the caller
 *   throws, because approving arguments nobody reviewed must never commit.
 */
export async function __MarkToolInvocationApprovedInTransaction(transaction: Prisma.TransactionClient, invocationId: string, expectedArguments: JsonValue, expectedArgumentsDigest: string, effectiveArguments: JsonValue, effectiveArgumentsDigest: string): Promise<boolean>
{
	return PrismaToolInvocationRepository.markApprovedInTransaction(transaction, invocationId, expectedArguments, expectedArgumentsDigest, effectiveArguments, effectiveArgumentsDigest);
}

/**
 * Fail one tool call whose approval was refused or expired, and store its result delivery.
 *
 * Called by: ./deferred-tool-approval.ts (denial and expiry) and
 * ./prisma-deferred-tool-approval-opener.ts (when an approval could not be opened at all).
 * @param failureCode - Short code recorded and delivered, for example `approval_denied` or
 *   `approval_expired`. Anything not matching the safe pattern is replaced.
 * @returns True when failed. False means the row was no longer awaiting approval; callers throw.
 */
export async function __MarkToolInvocationApprovalRejectedInTransaction(transaction: Prisma.TransactionClient, invocationId: string, now: Date, failureCode: string): Promise<boolean>
{
	return PrismaToolInvocationRepository.markApprovalRejectedInTransaction(transaction, invocationId, now, failureCode);
}
