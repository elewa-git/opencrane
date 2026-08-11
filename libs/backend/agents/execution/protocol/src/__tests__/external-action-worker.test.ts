import { ExternalActionClaimKinds, ExternalActionRecoveryModes, ToolInvocationEventTypes, ToolInvocationStates, type ToolInvocationClaim, type ToolInvocationClaimResult, type ToolInvocationCompletionResult, type ToolInvocationPreparationPolicy, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import type { Logger } from "@opencrane/backend/observability";
import type { RunInputSnapshot } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";
import { describe, expect, it, vi } from "vitest";

import { ExternalActionWorker } from "../external-action-worker.js";
import { ExternalActionProviderOutcomeKinds, type ExternalActionAdapterFactory, type ExternalActionExecutionContext, type ExternalActionExecutionContextLoader, type ExternalActionWorkerDependencies, type ExternalActionWorkerEvent, type ExternalActionWorkerInvocation, type ExternalActionWorkerUnitOfWork, type PreparedExternalActionAdapter, type ToolInvocationWorkSource } from "../external-action-worker.types.js";

/** Fixed server instant shared by every focused worker pass. */
const _NOW = new Date("2026-08-11T10:00:00.000Z");

/** Build one runnable invocation for a selected lifecycle and recovery mode. */
function _invocation(state: ToolInvocationStates, recoveryMode: ExternalActionRecoveryModes = ExternalActionRecoveryModes.Manual): ExternalActionWorkerInvocation
{
	return {
		id: "invocation-row-1",
		siloId: "silo-1",
		runId: "run-1",
		attempt: 1,
		agentRevisionId: "revision-1",
		subjectId: "user-1",
		candidateId: "candidate-1",
		toolInvocationId: "tool-call-1",
		toolRevisionId: "integration:calendar:calendar.read",
		arguments: { query: "today" },
		argumentsDigest: "sha256:arguments",
		effectiveArguments: { query: "today" },
		effectiveArgumentsDigest: "sha256:arguments",
		requestFingerprint: "sha256:fingerprint",
		approvalRequired: false,
		recoveryMode,
		recoveryKey: recoveryMode === ExternalActionRecoveryModes.Manual ? null : "provider-key-1",
		state,
		preparationAttempt: 0,
		retryDeadlineAt: new Date("2026-08-11T10:05:00.000Z"),
		nextPreparationAttemptAt: _NOW,
		claimAttempt: 0,
		claimKind: null,
		claimFence: 0,
		claimExpiresAt: null,
		result: null,
		failureCode: null,
		revision: 1,
	};
}

/** Build the minimal immutable snapshot fields the worker rebinds. */
function _context(): ExternalActionExecutionContext
{
	return { snapshot: { runId: "run-1", siloId: "silo-1", agentRevisionId: "revision-1", identitySnapshot: { executionSubjectId: "user-1" } } as unknown as RunInputSnapshot };
}

/** Deterministic single-row work source. */
class _Source implements ToolInvocationWorkSource
{
	/** Row returned to the next worker pass. */
	private readonly invocation: ExternalActionWorkerInvocation | null;

	/** Create a source over one optional row. */
	constructor(invocation: ExternalActionWorkerInvocation | null)
	{
		this.invocation = invocation;
	}

	/** Return the configured row. */
	async findNextRunnable(_now: Date): Promise<ExternalActionWorkerInvocation | null>
	{
		return this.invocation;
	}
}

/** Deterministic immutable-context loader. */
class _Contexts implements ExternalActionExecutionContextLoader
{
	/** Context returned to the worker. */
	private readonly context: ExternalActionExecutionContext | null;

	/** Create a loader over one optional context. */
	constructor(context: ExternalActionExecutionContext | null)
	{
		this.context = context;
	}

	/** Return the configured context. */
	async load(_runId: string, _attempt: number): Promise<ExternalActionExecutionContext | null>
	{
		return this.context;
	}
}

/** Recording adapter selected without provider I/O. */
class _Adapter implements PreparedExternalActionAdapter
{
	/** Recovery capability this fake proves. */
	readonly recoveryMode: ExternalActionRecoveryModes;
	/** Dispatch results returned in order. */
	private readonly dispatchOutcome: Awaited<ReturnType<PreparedExternalActionAdapter["dispatch"]>>;
	/** Reconciliation result returned by readback. */
	private readonly reconcileOutcome: Awaited<ReturnType<PreparedExternalActionAdapter["reconcile"]>>;
	/** Recovery keys handed to dispatch. */
	readonly dispatchKeys: Array<string | null> = [];
	/** Recovery keys handed to readback. */
	readonly reconcileKeys: string[] = [];

	/** Create a recording adapter for one explicit recovery capability. */
	constructor(recoveryMode: ExternalActionRecoveryModes, outcome = ExternalActionProviderOutcomeKinds.Succeeded)
	{
		this.recoveryMode = recoveryMode;
		this.dispatchOutcome = outcome === ExternalActionProviderOutcomeKinds.Succeeded
			? { kind: ExternalActionProviderOutcomeKinds.Succeeded, result: { ok: true } }
			: { kind: ExternalActionProviderOutcomeKinds.Ambiguous };
		this.reconcileOutcome = { kind: ExternalActionProviderOutcomeKinds.Succeeded, result: { recovered: true } };
	}

	/** Record one dispatch without exposing its arguments. */
	async dispatch(recoveryKey: string | null)
	{
		this.dispatchKeys.push(recoveryKey);
		return this.dispatchOutcome;
	}

	/** Record one non-mutating provider readback. */
	async reconcile(recoveryKey: string)
	{
		this.reconcileKeys.push(recoveryKey);
		return this.reconcileOutcome;
	}
}

/** Provider-free factory returning one recording adapter. */
class _Adapters implements ExternalActionAdapterFactory
{
	/** Adapter returned after preparation. */
	private readonly adapter: PreparedExternalActionAdapter;
	/** Number of provider-free constructions. */
	prepareCount = 0;

	/** Create the factory over one adapter. */
	constructor(adapter: PreparedExternalActionAdapter)
	{
		this.adapter = adapter;
	}

	/** Record construction and return the configured adapter. */
	prepare(_invocation: ExternalActionWorkerInvocation, _context: ExternalActionExecutionContext): PreparedExternalActionAdapter
	{
		this.prepareCount += 1;
		return this.adapter;
	}
}

/** In-memory state authority recording the worker's fenced transitions. */
class _Invocations implements ExternalActionWorkerUnitOfWork
{
	/** Invocation returned by lookups and claims. */
	private readonly invocation: ExternalActionWorkerInvocation;
	/** Preparation successes. */
	prepared = 0;
	/** Preparation failures and the exact fixed policy used. */
	preparationFailures: ToolInvocationPreparationPolicy[] = [];
	/** Claims acquired by the worker. */
	claims: ExternalActionClaimKinds[] = [];
	/** Successful results committed after dispatch or readback. */
	successes: JsonValue[] = [];
	/** Ambiguous claims handed to frozen recovery policy. */
	ambiguous: ToolInvocationClaim[] = [];
	/** Expired claim recoveries. */
	expiredRecoveries = 0;
	/** Exact claims released after provider-free start-event failure. */
	releasedClaims: ToolInvocationClaim[] = [];
	/** Lifecycle events atomically coupled to state changes by the fake UoW. */
	lifecycleEvents: ExternalActionWorkerEvent[] = [];

	/** Create an in-memory authority for one invocation. */
	constructor(invocation: ExternalActionWorkerInvocation)
	{
		this.invocation = invocation;
	}

	/** Return the configured row for its candidate. */
	async findByCandidate(_runId: string, _attempt: number, _candidateId: string): Promise<ToolInvocationRecord | null> { return this.invocation; }
	/** Return the configured row as runnable work. */
	async findNextRunnable(_now: Date): Promise<ToolInvocationRecord | null> { return this.invocation; }
	/** Record provider-free preparation success. */
	async markPrepared(_invocationId: string, _expectedRevision: number, _now: Date): Promise<ToolInvocationRecord | null>
	{
		this.prepared += 1;
		const state = this.invocation.approvalRequired ? ToolInvocationStates.AwaitingApproval : ToolInvocationStates.Ready;
		return { ...this.invocation, state, revision: this.invocation.revision + 1 };
	}
	/** Record one bounded provider-free preparation failure. */
	async recordPreparationFailure(_invocationId: string, _expectedRevision: number, _now: Date, policy: ToolInvocationPreparationPolicy, _failureCode: string): Promise<ToolInvocationRecord | null> { this.preparationFailures.push(policy); return this.invocation; }
	/** Record preparation failure and its retry-visible event as one fake transaction. */
	async recordPreparationFailureWithEvent(invocationId: string, expectedRevision: number, now: Date, policy: ToolInvocationPreparationPolicy, failureCode: string): Promise<ToolInvocationRecord | null>
	{
		const record = await this.recordPreparationFailure(invocationId, expectedRevision, now, policy, failureCode);
		this.lifecycleEvents.push({ runId: this.invocation.runId, attempt: this.invocation.attempt, eventType: ToolInvocationEventTypes.Failed, payload: { toolInvocationId: this.invocation.toolInvocationId, reason: failureCode, retryCount: this.invocation.preparationAttempt + 1, retryLimit: policy.attemptLimit, retrying: true } });
		return record;
	}
	/** Acquire one exact provider-operation claim. */
	async claim(_invocationId: string, kind: ExternalActionClaimKinds, _now: Date, _leaseMilliseconds: number): Promise<ToolInvocationClaimResult>
	{
		this.claims.push(kind);
		const state = kind === ExternalActionClaimKinds.Dispatch ? ToolInvocationStates.Claimed : ToolInvocationStates.Reconciling;
		const invocation = { ...this.invocation, state, claimKind: kind, claimFence: 1 };
		return { outcome: "claimed", claim: { invocationId: invocation.id, kind, fence: 1, revision: invocation.revision + 1 }, invocation };
	}
	/** Commit one successful provider result. */
	async completeSucceeded(_claim: ToolInvocationClaim, result: JsonValue, _now: Date): Promise<ToolInvocationCompletionResult> { this.successes.push(result); return { outcome: "winner", invocation: this.invocation }; }
	/** Commit success and its event as one fake transaction. */
	async completeSucceededWithEvent(claim: ToolInvocationClaim, result: JsonValue, now: Date): Promise<ToolInvocationCompletionResult> { const completed = await this.completeSucceeded(claim, result, now); this.lifecycleEvents.push({ runId: this.invocation.runId, attempt: this.invocation.attempt, eventType: ToolInvocationEventTypes.Completed, payload: { toolInvocationId: this.invocation.toolInvocationId } }); return completed; }
	/** Commit one proven provider failure. */
	async completeFailed(_claim: ToolInvocationClaim, _failureCode: string, _now: Date): Promise<ToolInvocationCompletionResult> { return { outcome: "winner", invocation: this.invocation }; }
	/** Commit failure and its event as one fake transaction. */
	async completeFailedWithEvent(claim: ToolInvocationClaim, failureCode: string, now: Date): Promise<ToolInvocationCompletionResult> { const completed = await this.completeFailed(claim, failureCode, now); this.lifecycleEvents.push({ runId: this.invocation.runId, attempt: this.invocation.attempt, eventType: ToolInvocationEventTypes.Failed, payload: { toolInvocationId: this.invocation.toolInvocationId, reason: failureCode, retryCount: this.invocation.preparationAttempt, retryLimit: 3, retrying: false } }); return completed; }
	/** Record an ambiguous result for frozen recovery policy. */
	async completeAmbiguous(claim: ToolInvocationClaim, _now: Date): Promise<ToolInvocationRecord | null> { this.ambiguous.push(claim); return this.invocation; }
	/** Apply ambiguity and append its event as one fake transaction. */
	async completeAmbiguousWithEvent(claim: ToolInvocationClaim, now: Date): Promise<ToolInvocationRecord | null> { const completed = await this.completeAmbiguous(claim, now); this.lifecycleEvents.push({ runId: this.invocation.runId, attempt: this.invocation.attempt, eventType: ToolInvocationEventTypes.Failed, payload: { toolInvocationId: this.invocation.toolInvocationId, reason: "external_action_provider_outcome_ambiguous", retryCount: this.invocation.preparationAttempt, retryLimit: 3, retrying: this.invocation.recoveryMode !== ExternalActionRecoveryModes.Manual } }); return completed; }
	/** Recover one expired provider claim without dispatching. */
	async recoverExpiredClaim(_invocationId: string, _now: Date): Promise<ToolInvocationRecord | null> { this.expiredRecoveries += 1; return this.invocation; }
	/** Release one exact claim and record its retry-visible failure event. */
	async releaseClaimBeforeDispatch(claim: ToolInvocationClaim, _now: Date): Promise<ToolInvocationRecord | null>
	{
		this.releasedClaims.push(claim);
		this.lifecycleEvents.push({ runId: this.invocation.runId, attempt: this.invocation.attempt, eventType: ToolInvocationEventTypes.Failed, payload: { toolInvocationId: this.invocation.toolInvocationId, reason: "external_action_start_event_failed", retryCount: this.invocation.preparationAttempt + 1, retryLimit: 3, retrying: true } });
		return this.invocation;
	}
}

/** Build complete worker dependencies around a selected invocation and adapter. */
function _dependencies(invocation: ExternalActionWorkerInvocation, adapter: PreparedExternalActionAdapter, context: ExternalActionExecutionContext | null = _context()): { readonly value: ExternalActionWorkerDependencies; readonly invocations: _Invocations; readonly adapters: _Adapters; readonly events: ExternalActionWorkerEvent[]; readonly approvalOpen: ReturnType<typeof vi.fn>; readonly logWarn: ReturnType<typeof vi.fn> }
{
	const invocations = new _Invocations(invocation);
	const adapters = new _Adapters(adapter);
	const events: ExternalActionWorkerEvent[] = [];
	const approvalOpen = vi.fn(async function _open() { return true; });
	const logWarn = vi.fn();
	return {
		value: {
			source: new _Source(invocation),
			invocations,
			contexts: new _Contexts(context),
			adapters,
			approvals: { open: approvalOpen },
			events: { append: async function _append(event: ExternalActionWorkerEvent) { events.push(event); } },
			clock: { now: function _now() { return _NOW; } },
			policy: { preparationAttemptLimit: 3, preparationRetryWindowMilliseconds: 300_000, preparationRetryDelayMilliseconds: 1_000, providerClaimLeaseMilliseconds: 30_000 },
			log: { warn: logWarn } as unknown as Logger,
		},
		invocations,
		adapters,
		events,
		approvalOpen,
		logWarn,
	};
}

describe("external action worker", function _suite()
{
	it("prepares without starting provider dispatch", async function _prepares()
	{
		const adapter = new _Adapter(ExternalActionRecoveryModes.Manual);
		const dependencies = _dependencies(_invocation(ToolInvocationStates.Preparing), adapter);
		await expect(new ExternalActionWorker(dependencies.value).runOnce()).resolves.toBe(true);
		expect(dependencies.invocations.prepared).toBe(1);
		expect(adapter.dispatchKeys).toEqual([]);
	});

	it("opens an approval immediately after provider-free preparation requires one", async function _opensApproval()
	{
		const adapter = new _Adapter(ExternalActionRecoveryModes.Manual);
		const invocation = { ..._invocation(ToolInvocationStates.Preparing), approvalRequired: true };
		const dependencies = _dependencies(invocation, adapter);

		await expect(new ExternalActionWorker(dependencies.value).runOnce()).resolves.toBe(true);
		expect(dependencies.approvalOpen).toHaveBeenCalledWith(expect.objectContaining({ state: ToolInvocationStates.AwaitingApproval, approvalRequired: true }), _context(), _NOW);
		expect(adapter.dispatchKeys).toEqual([]);
	});

	it("recovers an awaiting approval left between preparation and approval creation", async function _recoversApprovalGap()
	{
		const adapter = new _Adapter(ExternalActionRecoveryModes.Manual);
		const invocation = { ..._invocation(ToolInvocationStates.AwaitingApproval), approvalRequired: true };
		const dependencies = _dependencies(invocation, adapter);

		await expect(new ExternalActionWorker(dependencies.value).runOnce()).resolves.toBe(true);
		expect(dependencies.approvalOpen).toHaveBeenCalledWith(invocation, _context(), _NOW);
		expect(dependencies.adapters.prepareCount).toBe(0);
		expect(adapter.dispatchKeys).toEqual([]);
	});

	it("never dispatches when approval opening cannot prove an outcome", async function _approvalOpenFailure()
	{
		const adapter = new _Adapter(ExternalActionRecoveryModes.Manual);
		const invocation = { ..._invocation(ToolInvocationStates.AwaitingApproval), approvalRequired: true };
		const dependencies = _dependencies(invocation, adapter);
		dependencies.approvalOpen.mockRejectedValueOnce(new Error("approval recovery unavailable"));

		await expect(new ExternalActionWorker(dependencies.value).runOnce()).rejects.toThrow("approval recovery unavailable");
		expect(adapter.dispatchKeys).toEqual([]);
	});

	it("consumes the fixed three-in-five-minutes policy when preparation fails", async function _preparationFailure()
	{
		const dependencies = _dependencies(_invocation(ToolInvocationStates.Preparing), new _Adapter(ExternalActionRecoveryModes.Manual), null);
		await new ExternalActionWorker(dependencies.value).runOnce();
		expect(dependencies.invocations.preparationFailures).toEqual([{ attemptLimit: 3, retryWindowMilliseconds: 300_000, retryDelayMilliseconds: 1_000 }]);
		expect(dependencies.invocations.lifecycleEvents).toEqual([expect.objectContaining({ eventType: "tool.failed", payload: expect.objectContaining({ retryCount: 1, retryLimit: 3, retrying: true }) })]);
		expect(dependencies.logWarn).toHaveBeenCalledWith(expect.objectContaining({ failureKind: "external_action_preparation_failed" }), expect.any(String));
	});

	it("never automatically repeats an ambiguous manual provider call", async function _manualAmbiguity()
	{
		const adapter = new _Adapter(ExternalActionRecoveryModes.Manual, ExternalActionProviderOutcomeKinds.Ambiguous);
		const dependencies = _dependencies(_invocation(ToolInvocationStates.Ready), adapter);
		await new ExternalActionWorker(dependencies.value).runOnce();
		expect(adapter.dispatchKeys).toEqual([null]);
		expect(dependencies.invocations.ambiguous).toHaveLength(1);
		expect([...dependencies.events, ...dependencies.invocations.lifecycleEvents].map(function _type(event) { return event.eventType; })).toEqual(["tool.started", "tool.failed"]);
	});

	it("uses the exact frozen idempotency key for a provider-idempotent dispatch", async function _idempotentDispatch()
	{
		const adapter = new _Adapter(ExternalActionRecoveryModes.ProviderIdempotency);
		const dependencies = _dependencies(_invocation(ToolInvocationStates.Ready, ExternalActionRecoveryModes.ProviderIdempotency), adapter);
		await new ExternalActionWorker(dependencies.value).runOnce();
		expect(adapter.dispatchKeys).toEqual(["provider-key-1"]);
		expect(dependencies.invocations.successes).toEqual([{ ok: true }]);
		expect([...dependencies.events, ...dependencies.invocations.lifecycleEvents].map(function _type(event) { return event.eventType; })).toEqual(["tool.started", "tool.completed"]);
	});

	it("uses provider readback rather than dispatch for reconciliation work", async function _reconciles()
	{
		const adapter = new _Adapter(ExternalActionRecoveryModes.Reconciliation);
		const dependencies = _dependencies(_invocation(ToolInvocationStates.Reconciling, ExternalActionRecoveryModes.Reconciliation), adapter);
		await new ExternalActionWorker(dependencies.value).runOnce();
		expect(adapter.dispatchKeys).toEqual([]);
		expect(adapter.reconcileKeys).toEqual(["provider-key-1"]);
		expect(dependencies.invocations.claims).toEqual([ExternalActionClaimKinds.Reconcile]);
	});

	it("terminalises a Ready adapter reconstruction failure without provider I/O", async function _readyReconstructionFailure()
	{
		const adapter = new _Adapter(ExternalActionRecoveryModes.Manual);
		const dependencies = _dependencies(_invocation(ToolInvocationStates.Ready), adapter, null);
		await new ExternalActionWorker(dependencies.value).runOnce();
		expect(adapter.dispatchKeys).toEqual([]);
		expect(dependencies.invocations.claims).toEqual([ExternalActionClaimKinds.Dispatch]);
		expect(dependencies.invocations.lifecycleEvents).toEqual([expect.objectContaining({ eventType: ToolInvocationEventTypes.Failed, payload: expect.objectContaining({ reason: "external_action_pre_dispatch_unavailable", retrying: false }) })]);
	});

	it("releases the exact claim without provider I/O when tool.started cannot be persisted", async function _startEventFailure()
	{
		const adapter = new _Adapter(ExternalActionRecoveryModes.Manual);
		const dependencies = _dependencies(_invocation(ToolInvocationStates.Ready), adapter);
		const worker = new ExternalActionWorker({ ...dependencies.value, events: { append: async function _fail() { throw new Error("event store unavailable"); } } });
		await expect(worker.runOnce()).resolves.toBe(true);
		expect(adapter.dispatchKeys).toEqual([]);
		expect(dependencies.invocations.successes).toEqual([]);
		expect(dependencies.invocations.releasedClaims).toEqual([expect.objectContaining({ kind: ExternalActionClaimKinds.Dispatch, fence: 1 })]);
		expect(dependencies.invocations.lifecycleEvents).toEqual([expect.objectContaining({ eventType: ToolInvocationEventTypes.Failed, payload: expect.objectContaining({ reason: "external_action_start_event_failed", retrying: true }) })]);
	});

	it("recovers an expired claim without contacting the provider", async function _expiredClaim()
	{
		const adapter = new _Adapter(ExternalActionRecoveryModes.Manual);
		const dependencies = _dependencies(_invocation(ToolInvocationStates.Claimed), adapter);
		await new ExternalActionWorker(dependencies.value).runOnce();
		expect(dependencies.invocations.expiredRecoveries).toBe(1);
		expect(dependencies.adapters.prepareCount).toBe(0);
		expect(adapter.dispatchKeys).toEqual([]);
	});
});
