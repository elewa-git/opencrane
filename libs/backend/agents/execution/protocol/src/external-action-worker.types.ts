import type { ExternalActionRecoveryModes, ToolInvocationClaim, ToolInvocationLifecycleEvent, ToolInvocationRecord, ToolInvocationUnitOfWork } from "@opencrane/backend/server/iam/authorization";
import type { PersonalMemoryPermissionAuthority } from "@opencrane/backend/agents/execution/elicitation";
import type { Logger } from "@opencrane/backend/observability";
import type { RunInputSnapshot } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

/**
 * What one provider call is allowed to conclude.
 *
 * Only three answers exist, and the third is the reason this enum exists at all. `Ambiguous` is not
 * a kind of failure: it means the request may already have taken effect at the provider and this
 * process cannot prove either way - a timeout, a dropped socket, an error the adapter cannot
 * classify. Recording that as `Failed` is the expensive mistake, because a failed invocation is
 * reported to the model as not done, and a retry would charge the card or send the message twice.
 *
 * So the three answers oblige three different things. `Succeeded` and `Failed` are final and are
 * delivered to the run as its tool result. `Ambiguous` is handed to the invocation's recovery mode
 * instead: an adapter with a repeat-safe key may send again, one that can read the outcome back
 * reconciles it, and one that can do neither leaves the invocation for a person to decide. Only the
 * provider's own answer may produce `Succeeded` or `Failed`.
 *
 * @see ExternalActionRecoveryStrategy which decides what to do with each.
 * @see PreparedExternalActionAdapter.reconcile for the readback path out of `Ambiguous`.
 */
export enum ExternalActionProviderOutcomeKinds
{
	/** The provider answered with a result. Final: delivered to the run as the tool's result. */
	Succeeded = "succeeded",
	/** The provider refused, and said so. Final: delivered to the run as a failed tool result. */
	Failed = "failed",
	/** The request may or may not have taken effect. Never retried blindly; goes to recovery. */
	Ambiguous = "ambiguous",
}

/**
 * The result of one provider call made under a claim.
 *
 * A discriminated union on purpose: a caller cannot read `result` without having checked that the
 * call actually succeeded, and cannot invent a result for the ambiguous case, because there is no
 * field to put one in.
 *
 * @see ExternalActionProviderOutcomeKinds for what each kind obliges the caller to do.
 */
export type ExternalActionProviderOutcome =
	| { readonly kind: ExternalActionProviderOutcomeKinds.Succeeded; readonly result: JsonValue }
	| { readonly kind: ExternalActionProviderOutcomeKinds.Failed; readonly failureCode: string }
	| { readonly kind: ExternalActionProviderOutcomeKinds.Ambiguous };

/**
 * The frozen input an external action is allowed to see.
 *
 * Deliberately nothing but the admitted snapshot. Every decision an action makes - which dataset to
 * recall from, which integration to resolve, which subject it acts as - must come from here, so a
 * runtime that has since changed its mind cannot widen what the action may do.
 *
 * @see ExternalActionExecutionContextLoader which produces it.
 */
export interface ExternalActionExecutionContext
{
	/** The immutable run input snapshot admitted for this attempt. */
	readonly snapshot: RunInputSnapshot;
}

/**
 * Loads the frozen snapshot an invocation is bound to, before any adapter is built.
 *
 * A port, so the worker never reads Postgres itself. It is called again on every pass rather than
 * cached: after a crash and restart there is nothing in memory worth trusting, and the load doubles
 * as the check that this attempt is still the run's current one.
 *
 * Called by: `_rebuildAdapter` and `_openApproval` in external-action-worker.ts. Implemented by
 * `PrismaExternalActionExecutionContextRepository` and `...UnitOfWork`
 * (prisma-external-action-context-repository.ts), wired in
 * apps/opencrane/src/app/external-action-composition.ts.
 */
export interface ExternalActionExecutionContextLoader
{
	/**
	 * Load the frozen snapshot for one run attempt.
	 *
	 * @param runId - Run that owns the invocation.
	 * @param attempt - Attempt the invocation was admitted under.
	 * @returns The snapshot, or null when the run has moved to another attempt or has no snapshot.
	 * Null must stop the invocation: it means this work belongs to an attempt that is over.
	 */
	load(runId: string, attempt: number): Promise<ExternalActionExecutionContext | null>;
}

/** The Prisma-backed form of the loader, reading on a transaction the caller already owns. */
export interface ExternalActionExecutionContextRepository extends ExternalActionExecutionContextLoader {}

/** The same loader, but it opens its own transaction so one load sees a single consistent read. */
export interface ExternalActionExecutionContextUnitOfWork extends ExternalActionExecutionContextLoader {}

/**
 * The saved ToolInvocation row the worker works from.
 *
 * An alias, not a narrowed projection: the worker deliberately sees the whole durable row, because
 * its state, revision, recovery mode, and claim fields are what decide which step runs next. The
 * row is the only source of truth about an action - the runtime that proposed it is long gone by
 * the time the worker picks it up.
 */
export type ExternalActionWorkerInvocation = ToolInvocationRecord;

/**
 * Finds the next saved invocation the worker should act on.
 *
 * Owned by the ToolInvocation persistence package because "runnable" is a state question, not a
 * worker question: it covers work that has never been tried and work whose provider claim has
 * expired, which is how an invocation stranded by a crashed worker gets picked up again.
 *
 * Called by: `ExternalActionWorker._runPass` (external-action-worker.ts). Implemented by
 * `PrismaToolInvocationUnitOfWork`, passed as both `source` and `invocations` by
 * apps/opencrane/src/app/external-action-composition.ts.
 */
export interface ToolInvocationWorkSource
{
	/**
	 * Return at most one invocation to work on.
	 *
	 * @param now - Trusted server time, used to decide which claims have expired.
	 * @returns One invocation, or null when there is nothing to do. One at a time is the point: the
	 * worker holds no queue, so two processes racing on the same row are separated by the claim rather
	 * than by whichever read first.
	 */
	findNextRunnable(now: Date): Promise<ExternalActionWorkerInvocation | null>;
}

/** Routes a ready ToolInvocation into a class-specific durable executor before generic dispatch. */
export interface ExternalActionClassAdmission
{
	/** Admit one saved invocation, or report that the generic provider worker still owns it. */
	admitInvocation(toolInvocationRowId: string): Promise<"admitted" | "idempotent" | "not_ready" | "not_mcp">;
}

/**
 * Writes every durable state change the worker makes: prepared, claimed, released, completed.
 *
 * Owned by the authorization package, which is the only writer of tool-invocation state. Each write
 * is conditional on the revision that was read, so a worker whose lease quietly expired cannot
 * overwrite an outcome a newer worker already recorded.
 *
 * Called by: every step in external-action-worker.ts. Implemented by
 * `PrismaToolInvocationUnitOfWork`.
 */
export type ExternalActionWorkerUnitOfWork = ToolInvocationUnitOfWork;

/**
 * A provider adapter, built and settled before any claim is taken.
 *
 * The order matters: what an adapter can do is fixed while nothing is at stake, and the worker then
 * refuses to go on if `recoveryMode` is not the mode saved on the invocation. That check is what
 * stops an invocation admitted as retry-safe from later being run by an adapter that can prove
 * nothing, which would leave an ambiguous outcome with no way out.
 *
 * @see ExternalActionAdapterFactory which builds one.
 * @see ExternalActionRecoveryStrategy which decides whether `dispatch` or `reconcile` may be called.
 */
export interface PreparedExternalActionAdapter
{
	/** What this adapter can really guarantee. The worker stops the invocation if it differs from the mode saved on the row. */
	readonly recoveryMode: ExternalActionRecoveryModes;
	/** Dispatch exactly once, using the frozen provider key when the strategy requires it. */
	dispatch(recoveryKey: string | null, invocation: ToolInvocationRecord, claim: ToolInvocationClaim): Promise<ExternalActionProviderOutcome>;
	/** Read a provider outcome without repeating its effect. */
	reconcile(recoveryKey: string, invocation: ToolInvocationRecord, claim: ToolInvocationClaim): Promise<ExternalActionProviderOutcome>;
}

/**
 * Builds the adapter for one invocation, without touching a provider.
 *
 * Split from dispatch on purpose: everything that can fail cheaply - checking the arguments digest,
 * choosing a transport, resolving the snapshot's identity - happens here, before a claim exists, so
 * a failure at this stage can never strand a half-done provider call.
 *
 * Called by: `_rebuildAdapter` in external-action-worker.ts. Implemented by
 * `ProductionExternalActionAdapterFactory` (production-external-action-adapter.ts).
 */
export interface ExternalActionAdapterFactory
{
	/**
	 * Build one adapter. Must not start a provider request.
	 *
	 * @param invocation - The saved invocation, including the recovery mode the adapter must match.
	 * @param context - The frozen snapshot the action may read.
	 * @returns An adapter ready to be claimed and called.
	 * @throws {Error} When the invocation cannot be honoured at all - for example its arguments no
	 * longer hash to their saved digest. The worker turns a throw here into a preparation failure, or
	 * a pre-dispatch failure, and no provider is contacted.
	 */
	prepare(invocation: ExternalActionWorkerInvocation, context: ExternalActionExecutionContext): PreparedExternalActionAdapter;
}

/**
 * Opens the approval request that must be decided before an action may run.
 *
 * Separate from the provider adapter so that pausing a run and asking a person is never something a
 * provider transport can influence. The implementation pauses the run and creates the request in
 * one transaction, and it is safe to call again: after a crash between the two, the next pass finds
 * the request already open instead of asking twice.
 *
 * Called by: `_prepare` and `_openApproval` in external-action-worker.ts. Implemented by
 * `__CreateProductionExternalActionApprovalOpener` (production-external-action-approval.ts), wired
 * in apps/opencrane/src/app/external-action-composition.ts.
 */
export interface ExternalActionApprovalOpener
{
	/**
	 * Open the approval this invocation needs, or pick up the one already open.
	 *
	 * @param invocation - The invocation waiting for a decision.
	 * @param context - The frozen snapshot holding the tool schema the approver is shown.
	 * @param now - Trusted server time, from which the decision deadline is set.
	 * @returns True when a request is open. False when it could not be opened: the invocation stays
	 * where it is and no provider is called, so the run waits rather than acting unapproved.
	 * @throws {Error} When the snapshot cannot be loaded or does not match the invocation, or the
	 * frozen tool schema cannot be resolved - refusing loudly rather than approving a call whose
	 * schema is unknown.
	 */
	open(invocation: ExternalActionWorkerInvocation, context: ExternalActionExecutionContext, now: Date): Promise<boolean>;
}

/** Server clock for leases, deadlines, and saved timestamps. Injected so tests can fix the time. */
export interface ExternalActionWorkerClock
{
	/** Return one server-controlled instant. */
	now(): Date;
}

/** A tool lifecycle event. Only the server-side worker may emit these, because only it knows what the provider did. */
export type ExternalActionWorkerEvent = ToolInvocationLifecycleEvent;

/**
 * Saves tool lifecycle events.
 *
 * The started event is published before the provider is called, and the claim is released if that
 * publish fails, so no request ever goes out unannounced. An implementation must refuse a payload
 * that carries secrets.
 *
 * Called by: `_announceStart` in external-action-worker.ts. Implemented by
 * `PrismaToolInvocationLifecycleEventUnitOfWork`, wired in
 * apps/opencrane/src/app/external-action-composition.ts.
 */
export interface ExternalActionWorkerEventSink
{
	/**
	 * Add one lifecycle event to the run attempt that owns the invocation.
	 *
	 * @param event - The event to record.
	 * @returns Nothing. A rejection is meaningful: the caller releases its claim instead of calling the
	 * provider, so a lost event can never hide a real provider call.
	 */
	append(event: ExternalActionWorkerEvent): Promise<void>;
}

/**
 * The worker's fixed limits, set once when the process is wired up.
 *
 * Fixed rather than per-invocation so behaviour cannot drift between passes: the same attempt limit
 * and the same claim lease apply to every action in the fleet.
 *
 * Called by: `__CreateProductionExternalActionWorker` (production-external-action-worker.ts) builds
 * it from `TOOL_INVOCATION_PREPARATION_POLICY`.
 */
export interface ExternalActionWorkerPolicy
{
	/** Maximum provider-free preparation attempts. */
	readonly preparationAttemptLimit: number;
	/** How long preparation may keep retrying. */
	readonly preparationRetryWindowMilliseconds: number;
	/** Delay before another provider-free preparation attempt. */
	readonly preparationRetryDelayMilliseconds: number;
	/** Lease protecting one provider operation from a concurrent worker. */
	readonly providerClaimLeaseMilliseconds: number;
}

/**
 * Everything one worker needs, all injected.
 *
 * The worker owns no transport, no clock, and no database handle of its own, so a test can drive
 * every branch - including the ambiguous provider outcome - with no provider and no database.
 *
 * Called by: `__CreateProductionExternalActionWorker` (production-external-action-worker.ts).
 *
 * @see ProductionExternalActionWorkerDependencies for the smaller set the app supplies.
 */
export interface ExternalActionWorkerDependencies
{
	/** Finds the next saved invocation to work on. */
	readonly source: ToolInvocationWorkSource;
	/** Gives class-specific executors first refusal before the generic provider adapter can claim work. */
	readonly classAdmission: ExternalActionClassAdmission;
	/** Writes ToolInvocation state; each write only succeeds if the row is still on the revision it read. */
	readonly invocations: ExternalActionWorkerUnitOfWork;
	/** Loads the run's frozen snapshot. */
	readonly contexts: ExternalActionExecutionContextLoader;
	/** Builds provider adapters without contacting a provider. */
	readonly adapters: ExternalActionAdapterFactory;
	/** Opens approval requests; used only once preparation set the state to AwaitingApproval. */
	readonly approvals: ExternalActionApprovalOpener;
	/** Exact personal-memory input gate selected for the built-in recall revision. */
	readonly personalMemoryPermissions: PersonalMemoryPermissionAuthority;
	/** Server-owned canonical tool lifecycle events. */
	readonly events: ExternalActionWorkerEventSink;
	/** Trusted server clock. */
	readonly clock: ExternalActionWorkerClock;
	/** Frozen worker policy. */
	readonly policy: ExternalActionWorkerPolicy;
	/** Structured logger. Never log credentials to it. */
	readonly log: Logger;
}

/**
 * What a provider operation is allowed to do, for one recovery mode.
 *
 * The mode is fixed on the invocation at admission and cannot change later, so the strategy is
 * chosen from durable data rather than from whatever the current adapter feels able to do. Each
 * strategy refuses the claim kinds it must not serve - manual recovery, for instance, throws rather
 * than reconcile automatically - so an ambiguous outcome cannot quietly become a second provider
 * call.
 *
 * Called by: `_execute` in external-action-worker.ts, selected by
 * `_ExternalActionRecoveryStrategy` (external-action-recovery-strategy.ts).
 */
export interface ExternalActionRecoveryStrategy
{
	/**
	 * Run the operation this claim allows.
	 *
	 * @param adapter - The prepared adapter, already checked against the invocation's recovery mode.
	 * @param invocation - The claimed invocation, carrying the frozen recovery key when there is one.
	 * @param claim - The claim just taken; its kind decides dispatch versus readback.
	 * @returns What the provider concluded.
	 * @throws {Error} When the claim kind is not one this mode may serve, or a required recovery key is
	 * missing. The worker treats a throw as ambiguous, never as a failure.
	 */
	execute(adapter: PreparedExternalActionAdapter, invocation: ToolInvocationRecord, claim: ToolInvocationClaim): Promise<ExternalActionProviderOutcome>;
}
