import { ExternalActionClaimKinds, ToolInvocationEventTypes, ToolInvocationStates, type ToolInvocationClaim, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import { _ExternalActionRecoveryStrategy } from "./external-action-recovery-strategy.js";
import { ExternalActionProviderOutcomeKinds, type ExternalActionExecutionContext, type ExternalActionProviderOutcome, type ExternalActionWorkerDependencies, type ExternalActionWorkerInvocation, type PreparedExternalActionAdapter } from "./external-action-worker.types.js";

/** Safe durable code for a provider-free preparation failure. */
const _PREPARATION_FAILURE_CODE = "external_action_preparation_failed";

/** Validate that a loaded immutable snapshot is the invocation's exact authority context. */
function _contextMatchesInvocation(context: ExternalActionExecutionContext, invocation: ExternalActionWorkerInvocation): boolean
{
	const snapshot = context.snapshot;
	return snapshot.runId === invocation.runId
		&& snapshot.siloId === invocation.siloId
		&& snapshot.agentRevisionId === invocation.agentRevisionId
		&& snapshot.identitySnapshot.executionSubjectId === invocation.subjectId;
}

/** Process one durable external action at a time through fenced provider strategies. */
export class ExternalActionWorker
{
	/** Worker authorities, transports, policy, and safe evidence sink. */
	private readonly dependencies: ExternalActionWorkerDependencies;
	/** Active bounded pass, retained so interval ticks cannot overlap provider operations. */
	private activePass: Promise<boolean> | null = null;

	/** Create one bounded worker over explicit authority ports. */
	constructor(dependencies: ExternalActionWorkerDependencies)
	{
		this.dependencies = dependencies;
	}

	/** Process at most one runnable invocation and return when its durable transition is complete. */
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

	/** Wait until the current provider pass has committed its durable outcome. */
	async drain(): Promise<void>
	{
		await this.activePass;
	}

	/** Execute one internal pass after the non-overlap fence has been acquired. */
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
	// Load the frozen snapshot so mutable runtime state cannot stand in for authority.
	const context = await dependencies.contexts.load(invocation.runId, invocation.attempt);
	if (context === null || !_contextMatchesInvocation(context, invocation)) throw new Error(_PREPARATION_FAILURE_CODE);
	const adapter = dependencies.adapters.prepare(invocation, context);
	if (adapter.recoveryMode !== invocation.recoveryMode) throw new Error(_PREPARATION_FAILURE_CODE);
	return { context, adapter };
}

/** Complete provider-free preparation or consume one bounded preparation attempt. */
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

/** Open or recover one approval without granting provider dispatch on an unresolved result. */
async function _openApproval(invocation: ExternalActionWorkerInvocation, now: Date, dependencies: ExternalActionWorkerDependencies, preparedContext?: ExternalActionExecutionContext): Promise<boolean>
{
	// 1. Reload the immutable snapshot after a crash-gap recovery so approval never trusts process memory.
	const context = preparedContext ?? await dependencies.contexts.load(invocation.runId, invocation.attempt);
	if (context === null || !_contextMatchesInvocation(context, invocation)) throw new Error("external action approval context is unavailable");

	// 2. Let the approval authority atomically pause the run and create or recover the exact request.
	const opened = await dependencies.approvals.open(invocation, context, now);
	if (!opened) dependencies.log.warn({ runId: invocation.runId, attempt: invocation.attempt, toolInvocationId: invocation.toolInvocationId, failureKind: "external_action_approval_unavailable" }, "external action approval could not be opened and was closed without provider dispatch");
	return true;
}

/** Acquire one monotonic claim, invoke its frozen strategy, and commit only a definite outcome. */
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

	// 2. Persist the exact provider-operation fence before the adapter may start any request.
	const claimed = await dependencies.invocations.claim(invocation.id, kind, now, dependencies.policy.providerClaimLeaseMilliseconds);
	if (claimed.outcome !== "claimed") return claimed.outcome === "winner";
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

/** Apply recovery policy to a claim whose lease ran out before any durable outcome landed. */
async function _recoverExpiredClaim(invocation: ExternalActionWorkerInvocation, now: Date, dependencies: ExternalActionWorkerDependencies): Promise<boolean>
{
	await dependencies.invocations.recoverExpiredClaim(invocation.id, now);
	dependencies.log.warn({ runId: invocation.runId, attempt: invocation.attempt, toolInvocationId: invocation.toolInvocationId, recoveryMode: invocation.recoveryMode, failureKind: "external_action_expired_claim" }, "external action claim expired before a durable outcome");
	return true;
}

/** Close provider-free reconstruction failures without ever calling an external adapter. */
async function _failBeforeProvider(invocation: ExternalActionWorkerInvocation, kind: ExternalActionClaimKinds, now: Date, dependencies: ExternalActionWorkerDependencies): Promise<boolean>
{
	const claimed = await dependencies.invocations.claim(invocation.id, kind, now, dependencies.policy.providerClaimLeaseMilliseconds);
	if (claimed.outcome !== "claimed") return claimed.outcome === "winner";
	if (kind === ExternalActionClaimKinds.Reconcile)
	{
		await _completeAmbiguous(claimed.claim, claimed.invocation, dependencies);
		return true;
	}
	await dependencies.invocations.completeFailed(claimed.claim, "external_action_pre_dispatch_unavailable", dependencies.clock.now());
	dependencies.log.warn({ runId: invocation.runId, attempt: invocation.attempt, toolInvocationId: invocation.toolInvocationId, failureKind: "external_action_pre_dispatch_unavailable" }, "external action adapter was unavailable before provider dispatch");
	return true;
}

/** Apply the frozen recovery mode without exposing provider errors or response bodies. */
async function _completeAmbiguous(claim: ToolInvocationClaim, invocation: ToolInvocationRecord, dependencies: ExternalActionWorkerDependencies): Promise<void>
{
	await dependencies.invocations.completeAmbiguous(claim, dependencies.clock.now());
	dependencies.log.warn({ runId: invocation.runId, attempt: invocation.attempt, toolInvocationId: invocation.toolInvocationId, recoveryMode: invocation.recoveryMode, claimKind: claim.kind, failureKind: "external_action_provider_outcome_ambiguous" }, "external action provider outcome could not be proven");
}
