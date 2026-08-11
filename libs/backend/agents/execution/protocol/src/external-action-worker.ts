import { ExternalActionClaimKinds, ToolInvocationClaimOutcomes, ToolInvocationEventTypes, ToolInvocationStates, type ToolInvocationClaim, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { PERSONAL_MEMORY_RECALL_TOOL_REVISION } from "@opencrane/models/agents";

import { _ExternalActionRecoveryStrategy } from "./external-action-recovery-strategy.js";
import { ExternalActionProviderOutcomeKinds, type ExternalActionExecutionContext, type ExternalActionProviderOutcome, type ExternalActionWorkerDependencies, type ExternalActionWorkerInvocation, type PreparedExternalActionAdapter } from "./external-action-worker.types.js";

/** Failure code saved when preparation fails before any provider is contacted. */
const _PREPARATION_FAILURE_CODE = "external_action_preparation_failed";

/** Return whether the loaded snapshot belongs to the same run, silo, revision, and subject as this invocation. */
function _contextMatchesInvocation(context: ExternalActionExecutionContext, invocation: ExternalActionWorkerInvocation): boolean
{
	const snapshot = context.snapshot;
	return snapshot.runId === invocation.runId
		&& snapshot.siloId === invocation.siloId
		&& snapshot.agentRevisionId === invocation.agentRevisionId
		&& snapshot.identitySnapshot.executionSubjectId === invocation.subjectId;
}

/**
 * Runs saved external actions one at a time, each under a claim.
 *
 * One pass handles exactly one invocation and moves it one step: prepare it, open its approval,
 * call the provider, or recover a claim whose lease ran out. Finished invocations are left alone.
 * Passes never overlap, so a timer tick arriving while a provider call is in flight is dropped
 * rather than starting a second call.
 *
 * The safety rule running through every step: nothing reaches a provider until the claim that
 * fences it is saved, and only an answer the provider actually gave is recorded as success or
 * failure. Anything else is ambiguous and goes to the invocation's recovery mode.
 *
 * Called by: built by `__CreateProductionExternalActionWorker`
 * (production-external-action-worker.ts); apps/opencrane/src/app/background-workers.ts drives
 * `runOnce` on an interval and awaits `drain` at shutdown.
 *
 * @see ExternalActionProviderOutcomeKinds for why an unclear result is not a failure.
 */
export class ExternalActionWorker
{
	/** The ports, transports, limits, and logger this worker uses. */
	private readonly dependencies: ExternalActionWorkerDependencies;
	/** The pass that is currently running, kept so a timer tick cannot start a second one while a provider call is in flight. */
	private activePass: Promise<boolean> | null = null;

	/** Create the worker over its injected ports. */
	constructor(dependencies: ExternalActionWorkerDependencies)
	{
		this.dependencies = dependencies;
	}

	/**
	 * Handle at most one invocation, and return once its state change is saved.
	 *
	 * @returns True when an invocation was worked on. False when there was nothing to do, or a pass
	 * was already running - neither is an error and neither needs a retry, because the next tick will
	 * look again.
	 */
	async runOnce(): Promise<boolean>
	{
		if (this.activePass !== null) return false;
		const activePass = this._runPass();
		this.activePass = activePass;
		try
		{
			return await activePass;
		}
		finally
		{
			if (this.activePass === activePass) this.activePass = null;
		}
	}

	/**
	 * Wait until the pass that is running has saved its outcome.
	 *
	 * Called at shutdown, so the process cannot exit between a provider call and the record of what
	 * that call did. Returns immediately when no pass is running.
	 */
	async drain(): Promise<void>
	{
		await this.activePass;
	}

	/** Run one pass. The caller has already made sure no other pass is running. */
	private async _runPass(): Promise<boolean>
	{
		const dependencies = this.dependencies;
		const now = dependencies.clock.now();
		const invocation = await dependencies.source.findNextRunnable(now);
		if (invocation === null) return false;
		return ___DoWithTrace("external_action.worker.run", { runId: invocation.runId, attempt: invocation.attempt, toolInvocationId: invocation.toolInvocationId, state: invocation.state, recoveryMode: invocation.recoveryMode }, async function _run()
		{
			switch (invocation.state)
			{
				case ToolInvocationStates.Preparing: return _prepare(invocation, now, dependencies);
				case ToolInvocationStates.AwaitingApproval: return _openApproval(invocation, now, dependencies);
				case ToolInvocationStates.Ready: return _execute(invocation, ExternalActionClaimKinds.Dispatch, now, dependencies);
				case ToolInvocationStates.Reconciling: return _execute(invocation, ExternalActionClaimKinds.Reconcile, now, dependencies);
				case ToolInvocationStates.Claimed: return _recoverExpiredClaim(invocation, now, dependencies);
				// Succeeded, Failed, and RecoveryRequired are finished: the worker leaves them alone.
				default: return false;
			}
		});
	}
}

/**
 * Rebuilds the run context and its provider adapter, touching no provider.
 *
 * Both the preparing and the claiming path need exactly this, and both need it to fail loudly:
 * a mismatched snapshot or an adapter that cannot honour the invocation's frozen recovery mode
 * must stop the invocation before any request could go out. Throws `_PREPARATION_FAILURE_CODE`.
 */
async function _rebuildAdapter(invocation: ExternalActionWorkerInvocation, dependencies: ExternalActionWorkerDependencies): Promise<{ readonly context: ExternalActionExecutionContext; readonly adapter: PreparedExternalActionAdapter }>
{
	// Load the frozen snapshot, so nothing the runtime can change is used to decide what is allowed.
	const context = await dependencies.contexts.load(invocation.runId, invocation.attempt);
	if (context === null || !_contextMatchesInvocation(context, invocation)) throw new Error(_PREPARATION_FAILURE_CODE);
	const adapter = dependencies.adapters.prepare(invocation, context);
	if (adapter.recoveryMode !== invocation.recoveryMode) throw new Error(_PREPARATION_FAILURE_CODE);
	return { context, adapter };
}

/** Finish preparation without contacting a provider, or record one failed preparation attempt. */
async function _prepare(invocation: ExternalActionWorkerInvocation, now: Date, dependencies: ExternalActionWorkerDependencies): Promise<boolean>
{
	let context: ExternalActionExecutionContext;
	let prepared: ToolInvocationRecord | null;
	try
	{
		// 1. Rebuild the context and adapter first; neither step may start a provider request.
		context = (await _rebuildAdapter(invocation, dependencies)).context;

		// 2. Mark the invocation ready or awaiting approval only after all provider-free work succeeds.
		prepared = await dependencies.invocations.markPrepared(invocation.id, invocation.revision, now);
	}
	catch
	{
		await dependencies.invocations.recordPreparationFailure(invocation.id, invocation.revision, now, {
			attemptLimit: dependencies.policy.preparationAttemptLimit,
			retryWindowMilliseconds: dependencies.policy.preparationRetryWindowMilliseconds,
			retryDelayMilliseconds: dependencies.policy.preparationRetryDelayMilliseconds,
		}, _PREPARATION_FAILURE_CODE);
		dependencies.log.warn({ runId: invocation.runId, attempt: invocation.attempt, toolInvocationId: invocation.toolInvocationId, preparationAttempt: invocation.preparationAttempt + 1, failureKind: _PREPARATION_FAILURE_CODE }, "external action preparation failed before provider dispatch");
		return true;
	}
	if (prepared?.state === ToolInvocationStates.AwaitingApproval) return _openApproval(prepared, now, dependencies, context);
	return true;
}

/** Open the approval request, or pick up one already open, without letting the provider be called while it is undecided. */
async function _openApproval(invocation: ExternalActionWorkerInvocation, now: Date, dependencies: ExternalActionWorkerDependencies, preparedContext?: ExternalActionExecutionContext): Promise<boolean>
{
	// 1. Read the snapshot again: after a crash and restart, nothing held in memory can be trusted.
	const context = preparedContext ?? await dependencies.contexts.load(invocation.runId, invocation.attempt);
	if (context === null || !_contextMatchesInvocation(context, invocation)) throw new Error("external action approval context is unavailable");

	// 2. Let the approval authority atomically pause the run and create or recover the exact request.
	const opened = invocation.toolRevisionId === PERSONAL_MEMORY_RECALL_TOOL_REVISION
		? await dependencies.personalMemoryPermissions.openMemoryPermission(invocation, context.snapshot, now)
		: await dependencies.approvals.open(invocation, context, now);
	if (!opened) dependencies.log.warn({ runId: invocation.runId, attempt: invocation.attempt, toolInvocationId: invocation.toolInvocationId, failureKind: "external_action_approval_unavailable" }, "external action approval could not be opened and was closed without provider dispatch");
	return true;
}

/** Take the claim, run the strategy for this invocation's recovery mode, and save the result only when the provider gave a definite one. */
async function _execute(invocation: ExternalActionWorkerInvocation, kind: ExternalActionClaimKinds, now: Date, dependencies: ExternalActionWorkerDependencies): Promise<boolean>
{
	// 1. Rebuild the adapter before claiming. A failure here cannot strand provider work in Claimed,
	// because no provider operation has started yet.
	let adapter: PreparedExternalActionAdapter;
	try
	{
		adapter = (await _rebuildAdapter(invocation, dependencies)).adapter;
	}
	catch
	{
		return _failBeforeProvider(invocation, kind, now, dependencies);
	}

	// 2. Save the claim that fences this provider operation before the adapter may send anything.
	const claimed = await dependencies.invocations.claim(invocation.id, kind, now, dependencies.policy.providerClaimLeaseMilliseconds);
	if (claimed.outcome !== ToolInvocationClaimOutcomes.Claimed) return claimed.outcome === ToolInvocationClaimOutcomes.Winner;
	if (!await _announceStart(invocation, claimed.claim, dependencies)) return true;

	// 3. Run the frozen recovery strategy. Only this call is caught: a thrown adapter call is
	// ambiguous because this layer cannot prove whether the request crossed the transport boundary.
	// A later commit failure must stay loud, so it is deliberately left outside the catch.
	let outcome: ExternalActionProviderOutcome;
	try
	{
		outcome = await _ExternalActionRecoveryStrategy(invocation.recoveryMode).execute(adapter, claimed.invocation, claimed.claim);
	}
	catch
	{
		await _completeAmbiguous(claimed.claim, claimed.invocation, dependencies);
		return true;
	}

	// 4. Commit the proven outcome.
	await _commitProviderOutcome(outcome, invocation, claimed.claim, claimed.invocation, dependencies);
	return true;
}

/** Publish the started event, releasing the claim if it fails so no request goes out unannounced. */
async function _announceStart(invocation: ExternalActionWorkerInvocation, claim: ToolInvocationClaim, dependencies: ExternalActionWorkerDependencies): Promise<boolean>
{
	try
	{
		await dependencies.events.append({ runId: invocation.runId, attempt: invocation.attempt, eventType: ToolInvocationEventTypes.Started, payload: { toolInvocationId: invocation.toolInvocationId } });
		return true;
	}
	catch
	{
		await dependencies.invocations.releaseClaimBeforeDispatch(claim, dependencies.clock.now());
		dependencies.log.warn({ runId: invocation.runId, attempt: invocation.attempt, toolInvocationId: invocation.toolInvocationId, claimFence: claim.fence, failureKind: "external_action_start_event_unavailable" }, "external action claim released before provider dispatch");
		return false;
	}
}

/** Commit only a result the provider itself returned; payloads never enter logs or spans. */
async function _commitProviderOutcome(outcome: ExternalActionProviderOutcome, invocation: ExternalActionWorkerInvocation, claim: ToolInvocationClaim, claimedInvocation: ToolInvocationRecord, dependencies: ExternalActionWorkerDependencies): Promise<void>
{
	switch (outcome.kind)
	{
		case ExternalActionProviderOutcomeKinds.Succeeded:
			await dependencies.invocations.completeSucceeded(claim, outcome.result, dependencies.clock.now());
			return;
		case ExternalActionProviderOutcomeKinds.Failed:
			await dependencies.invocations.completeFailed(claim, outcome.failureCode, dependencies.clock.now());
			dependencies.log.warn({ runId: invocation.runId, attempt: invocation.attempt, toolInvocationId: invocation.toolInvocationId, recoveryMode: invocation.recoveryMode, claimKind: claim.kind, failureKind: outcome.failureCode }, "external action provider returned a definite failure");
			return;
		default:
			await _completeAmbiguous(claim, claimedInvocation, dependencies);
	}
}

/** Apply the recovery rules to a claim whose lease ran out before any result was saved. */
async function _recoverExpiredClaim(invocation: ExternalActionWorkerInvocation, now: Date, dependencies: ExternalActionWorkerDependencies): Promise<boolean>
{
	await dependencies.invocations.recoverExpiredClaim(invocation.id, now);
	dependencies.log.warn({ runId: invocation.runId, attempt: invocation.attempt, toolInvocationId: invocation.toolInvocationId, recoveryMode: invocation.recoveryMode, failureKind: "external_action_expired_claim" }, "external action claim expired before a durable outcome");
	return true;
}

/** Close out an invocation whose context or adapter could not be rebuilt, without calling a provider. */
async function _failBeforeProvider(invocation: ExternalActionWorkerInvocation, kind: ExternalActionClaimKinds, now: Date, dependencies: ExternalActionWorkerDependencies): Promise<boolean>
{
	const claimed = await dependencies.invocations.claim(invocation.id, kind, now, dependencies.policy.providerClaimLeaseMilliseconds);
	if (claimed.outcome !== ToolInvocationClaimOutcomes.Claimed) return claimed.outcome === ToolInvocationClaimOutcomes.Winner;
	if (kind === ExternalActionClaimKinds.Reconcile)
	{
		await _completeAmbiguous(claimed.claim, claimed.invocation, dependencies);
		return true;
	}
	await dependencies.invocations.completeFailed(claimed.claim, "external_action_pre_dispatch_unavailable", dependencies.clock.now());
	dependencies.log.warn({ runId: invocation.runId, attempt: invocation.attempt, toolInvocationId: invocation.toolInvocationId, failureKind: "external_action_pre_dispatch_unavailable" }, "external action adapter was unavailable before provider dispatch");
	return true;
}

/** Record an unproven outcome under the invocation's recovery mode, without logging provider errors or response bodies. */
async function _completeAmbiguous(claim: ToolInvocationClaim, invocation: ToolInvocationRecord, dependencies: ExternalActionWorkerDependencies): Promise<void>
{
	await dependencies.invocations.completeAmbiguous(claim, dependencies.clock.now());
	dependencies.log.warn({ runId: invocation.runId, attempt: invocation.attempt, toolInvocationId: invocation.toolInvocationId, recoveryMode: invocation.recoveryMode, claimKind: claim.kind, failureKind: "external_action_provider_outcome_ambiguous" }, "external action provider outcome could not be proven");
}
