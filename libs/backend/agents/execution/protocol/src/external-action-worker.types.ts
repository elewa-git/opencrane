import type { ExternalActionRecoveryModes, ToolInvocationClaim, ToolInvocationLifecycleEvent, ToolInvocationRecord, ToolInvocationUnitOfWork } from "@opencrane/backend/server/iam/authorization";
import type { Logger } from "@opencrane/backend/observability";
import type { RunInputSnapshot } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

/** Stable result categories returned by one provider operation. */
export enum ExternalActionProviderOutcomeKinds
{
	/** The provider returned one definite successful result. */
	Succeeded = "succeeded",
	/** The provider returned one definite terminal refusal. */
	Failed = "failed",
	/** Dispatch began but no trustworthy outcome can be established. */
	Ambiguous = "ambiguous",
}

/** Result of exactly one fenced provider dispatch or readback operation. */
export type ExternalActionProviderOutcome =
	| { readonly kind: ExternalActionProviderOutcomeKinds.Succeeded; readonly result: JsonValue }
	| { readonly kind: ExternalActionProviderOutcomeKinds.Failed; readonly failureCode: string }
	| { readonly kind: ExternalActionProviderOutcomeKinds.Ambiguous };

/** Frozen run context loaded from the canonical snapshot authority. */
export interface ExternalActionExecutionContext
{
	/** Exact immutable run input snapshot admitted for this attempt. */
	readonly snapshot: RunInputSnapshot;
}

/** Canonical snapshot loader used before any provider adapter starts. */
export interface ExternalActionExecutionContextLoader
{
	/** Load the exact immutable snapshot for one invocation attempt. */
	load(runId: string, attempt: number): Promise<ExternalActionExecutionContext | null>;
}

/** Prisma-authorized repository form of the immutable execution-context loader. */
export interface ExternalActionExecutionContextRepository extends ExternalActionExecutionContextLoader {}

/** Process-scoped transaction owner for immutable execution-context reads. */
export interface ExternalActionExecutionContextUnitOfWork extends ExternalActionExecutionContextLoader {}

/** Invocation projection required to rebind a durable action to its immutable run authority. */
export type ExternalActionWorkerInvocation = ToolInvocationRecord;

/** Durable work discovery owned by the ToolInvocation persistence package. */
export interface ToolInvocationWorkSource
{
	/** Return at most one runnable invocation, including an expired provider claim. */
	findNextRunnable(now: Date): Promise<ExternalActionWorkerInvocation | null>;
}

/** Authorization-owned durable state authority used by the process worker. */
export type ExternalActionWorkerUnitOfWork = ToolInvocationUnitOfWork;

/** Prepared provider adapter whose capabilities are fixed before a claim is acquired. */
export interface PreparedExternalActionAdapter
{
	/** Recovery capability the adapter can actually enforce for this invocation. */
	readonly recoveryMode: ExternalActionRecoveryModes;
	/** Dispatch exactly once, using the frozen provider key when the strategy requires it. */
	dispatch(recoveryKey: string | null): Promise<ExternalActionProviderOutcome>;
	/** Read a provider outcome without repeating its effect. */
	reconcile(recoveryKey: string): Promise<ExternalActionProviderOutcome>;
}

/** Factory that performs only provider-free validation and adapter construction. */
export interface ExternalActionAdapterFactory
{
	/** Build one adapter without starting a provider request. */
	prepare(invocation: ExternalActionWorkerInvocation, context: ExternalActionExecutionContext): PreparedExternalActionAdapter;
}

/** Trusted wall clock used for leases, deadlines, and recovery evidence. */
export interface ExternalActionWorkerClock
{
	/** Return one server-controlled instant. */
	now(): Date;
}

/** Safe canonical event emitted only by the server-side tool worker. */
export type ExternalActionWorkerEvent = ToolInvocationLifecycleEvent;

/** Canonical server-event sink; implementations must reject secret-bearing payload extensions. */
export interface ExternalActionWorkerEventSink
{
	/** Append one bounded lifecycle event for the owning run attempt. */
	append(event: ExternalActionWorkerEvent): Promise<void>;
}

/** Fixed worker policy frozen at process composition. */
export interface ExternalActionWorkerPolicy
{
	/** Maximum provider-free preparation attempts. */
	readonly preparationAttemptLimit: number;
	/** Hard provider-free preparation retry window. */
	readonly preparationRetryWindowMilliseconds: number;
	/** Delay before another provider-free preparation attempt. */
	readonly preparationRetryDelayMilliseconds: number;
	/** Lease protecting one provider operation from a concurrent worker. */
	readonly providerClaimLeaseMilliseconds: number;
}

/** Complete dependencies for one bounded process-owned worker. */
export interface ExternalActionWorkerDependencies
{
	/** Durable runnable-work discovery. */
	readonly source: ToolInvocationWorkSource;
	/** ToolInvocation state and compare-and-set authority. */
	readonly invocations: ExternalActionWorkerUnitOfWork;
	/** Canonical immutable run context loader. */
	readonly contexts: ExternalActionExecutionContextLoader;
	/** Provider-free adapter factory. */
	readonly adapters: ExternalActionAdapterFactory;
	/** Server-owned canonical tool lifecycle events. */
	readonly events: ExternalActionWorkerEventSink;
	/** Trusted server clock. */
	readonly clock: ExternalActionWorkerClock;
	/** Frozen worker policy. */
	readonly policy: ExternalActionWorkerPolicy;
	/** Structured, credential-free evidence sink. */
	readonly log: Logger;
}

/** One explicit recovery strategy selected by the invocation's frozen mode. */
export interface ExternalActionRecoveryStrategy
{
	/** Execute the operation permitted by an exact fenced claim. */
	execute(adapter: PreparedExternalActionAdapter, invocation: ToolInvocationRecord, claim: ToolInvocationClaim): Promise<ExternalActionProviderOutcome>;
}
