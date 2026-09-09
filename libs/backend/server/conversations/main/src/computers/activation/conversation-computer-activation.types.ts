import type { ActiveLeaseScope, ComputerScope } from "@opencrane/contracts";

/**
 * Carries one stream-bound computer activation request after the listener validates its delivery.
 *
 * The silo queue, computer, conversation, and generation stay together so the authority can reject
 * a stale wake request rather than applying it to a replacement computer lease. The fields stay flat
 * because the request arrives before the agent identity or a lease id exists: the queue event names
 * the computer and the generation it wants, and the authority resolves the rest.
 * @see ComputerScope for the bundle the authority builds once the projection supplies the identity.
 */
export interface ConversationComputerActivationCommand
{
	/** Identifies the silo-local activation queue. */
	readonly siloId: string;
	/** Identifies the logical computer to wake. */
	readonly computerId: string;
	/** Identifies the computer's one owning conversation. */
	readonly conversationId: string;
	/** Fences this wake request to one expected computer generation. */
	readonly generation: number;
}

/**
 * Names the persistent-subscription action an authority outcome asks the listener to take.
 *
 * `Park` removes a terminal failure from live delivery for operator repair; `Retry` keeps an
 * in-progress or transiently failed delivery live after a bounded wait.
 */
export enum ConversationComputerActivationQueueActions
{
	/** Move the delivery to the consumer group's parked queue. */
	Park = "park",
	/** Ask KurrentDB to redeliver after the listener's backoff wait. */
	Retry = "retry",
}

/**
 * Directs the listener to remove a valid but terminal activation failure from its active queue.
 *
 * Parking preserves the delivery and its operator-facing reason for repair instead of retrying an
 * outcome the authority has already classified as terminal.
 */
export interface ConversationComputerActivationParked
{
	/** Identifies the persistent-subscription action for this terminal activation outcome. */
	readonly action: ConversationComputerActivationQueueActions.Park;
	/** Explains the terminal outcome to the operator inspecting the parked delivery. */
	readonly reason: string;
}

/**
 * Directs the listener to keep the delivery live because the sandbox is not assigned yet.
 *
 * A gVisor Pod cold start takes seconds to minutes. This outcome is expected progress, not a
 * failure, so the listener waits with bounded backoff and asks KurrentDB to redeliver instead of
 * spending the group's retry budget on immediate retries.
 */
export interface ConversationComputerActivationPending
{
	/** Identifies the persistent-subscription action for an in-progress cold start. */
	readonly action: ConversationComputerActivationQueueActions.Retry;
	/** Explains the wait to the operator inspecting delivery retries. */
	readonly reason: string;
}

/**
 * Lists every authority outcome a persistent activation delivery can resolve.
 *
 * Activated, idempotent, and denied outcomes acknowledge the delivery. A parked outcome moves it
 * aside with an operator-facing reason; a pending outcome retries after backoff; an authority
 * exception is the separate transient-failure path, which also retries after backoff.
 */
export type ConversationComputerActivationOutcome = "activated" | "idempotent" | "denied" | ConversationComputerActivationParked | ConversationComputerActivationPending;

/** Lets a test replace the real clock wait used between a not-ready delivery and its retry. */
export interface ConversationComputerActivationListenerOptions
{
	/** Resolves after the requested number of milliseconds, or earlier once the signal aborts; defaults to a timer. */
	readonly wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
	/** Shortens the retry wait so a held delivery is handed back as soon as shutdown starts. */
	readonly signal?: AbortSignal;
}

/**
 * Names the lifecycle state of one supervised activation consumer.
 *
 * The state is process-local and point-in-time. `Failed` is terminal for this consumer: the process
 * must restart before the silo queue is consumed again from this replica.
 */
export enum ConversationComputerActivationConsumerStates
{
	/** No subscription has been opened yet. */
	Starting = "starting",
	/** A persistent subscription is open and deliveries are being handled. */
	Subscribed = "subscribed",
	/** The subscription dropped and the consumer is waiting before it reopens. */
	Reconnecting = "reconnecting",
	/** The consumer used its whole consecutive-failure budget and will not reopen. */
	Failed = "failed",
	/** Shutdown stopped the consumer after its in-flight delivery settled. */
	Stopped = "stopped",
}

/** Names the observations one supervised consumer reports to its composition. */
export enum ConversationComputerActivationConsumerEventKinds
{
	/** A persistent subscription opened. */
	Subscribed = "subscribed",
	/** The subscription dropped, ended, or a queue action failed; the consumer will reopen after the reported wait. */
	Dropped = "dropped",
	/** The consumer gave up after its last consecutive failure. */
	Failed = "failed",
	/** Shutdown completed. */
	Stopped = "stopped",
}

/** Reports that one persistent subscription opened. */
export interface ConversationComputerActivationConsumerSubscribed
{
	/** Identifies the observation. */
	readonly kind: ConversationComputerActivationConsumerEventKinds.Subscribed;
}

/** Reports one dropped subscription and the wait before the consumer reopens. */
export interface ConversationComputerActivationConsumerDropped
{
	/** Identifies the observation. */
	readonly kind: ConversationComputerActivationConsumerEventKinds.Dropped;
	/** Carries the error that ended the session, or the stream-ended reason. */
	readonly error: unknown;
	/** Counts drops since the last healthy session. */
	readonly consecutiveFailures: number;
	/** Reports the jittered wait before the next subscription attempt. */
	readonly nextWaitMilliseconds: number;
}

/** Reports that the consumer used its whole failure budget. */
export interface ConversationComputerActivationConsumerFailed
{
	/** Identifies the observation. */
	readonly kind: ConversationComputerActivationConsumerEventKinds.Failed;
	/** Carries the last error before the consumer gave up. */
	readonly error: unknown;
	/** Counts the consecutive drops that used the budget. */
	readonly consecutiveFailures: number;
}

/** Reports that shutdown finished. */
export interface ConversationComputerActivationConsumerStopped
{
	/** Identifies the observation. */
	readonly kind: ConversationComputerActivationConsumerEventKinds.Stopped;
}

/** Lists every observation a supervised consumer reports. */
export type ConversationComputerActivationConsumerEvent = ConversationComputerActivationConsumerSubscribed | ConversationComputerActivationConsumerDropped | ConversationComputerActivationConsumerFailed | ConversationComputerActivationConsumerStopped;

/** Point-in-time health of one supervised consumer, read by the composition and by tests. */
export interface ConversationComputerActivationConsumerHealth
{
	/** Current lifecycle state. */
	readonly state: ConversationComputerActivationConsumerStates;
	/** Drops since the last healthy session; zero while healthy. */
	readonly consecutiveFailures: number;
}

/**
 * Bounds how a dropped subscription is reopened.
 *
 * The wait doubles from the base up to the cap with random jitter, so several replicas that lose
 * KurrentDB at the same moment do not reconnect in lockstep. A session that delivered an event or
 * stayed open for the healthy duration resets the failure count.
 */
export interface ConversationComputerActivationResubscribePolicy
{
	/** First wait after a drop. */
	readonly baseMilliseconds: number;
	/** Longest wait between attempts. */
	readonly maxMilliseconds: number;
	/** Consecutive drops after which the consumer stops trying and reports `Failed`. */
	readonly maxConsecutiveFailures: number;
	/** Open time after which a session counts as healthy and clears earlier drops. */
	readonly healthySessionMilliseconds: number;
}

/** Settings for one supervised activation consumer. */
export interface ConversationComputerActivationConsumerOptions extends ConversationComputerActivationListenerOptions
{
	/** Stops the consumer: no new deliveries, the in-flight one settles, then the subscription closes. */
	readonly signal: AbortSignal;
	/** Overrides part of the default reopen policy. */
	readonly resubscribe?: Partial<ConversationComputerActivationResubscribePolicy>;
	/** Receives lifecycle observations so the composition can log them. */
	readonly onEvent?: (event: ConversationComputerActivationConsumerEvent) => void;
	/** Supplies jitter in [0, 1); defaults to `Math.random`. */
	readonly random?: () => number;
	/** Supplies epoch milliseconds; defaults to `Date.now`. */
	readonly now?: () => number;
}

/**
 * Owns one supervised, competing consumer for the silo activation queue.
 *
 * Called by: conversation-computer-activation-composition.ts.
 */
export interface ConversationComputerActivationConsumer
{
	/** Settles once the consumer has stopped or failed; it never rejects. */
	readonly done: Promise<void>;
	/** Reads the current health snapshot. */
	health(): ConversationComputerActivationConsumerHealth;
}

/**
 * Decides whether a validated computer generation can activate.
 *
 * The listener supplies a stream-bound command and maps this result to the persistent queue action;
 * the authority owns current computer, lease, and Agent Sandbox claim decisions.
 */
export interface ConversationComputerActivationAuthority
{
	/** Activates the exact durable computer generation or returns its terminal queue outcome. */
	activate(command: ConversationComputerActivationCommand): Promise<ConversationComputerActivationOutcome>;
}

/** Immutable projection coordinates needed to locate one computer aggregate. */
export interface ConversationComputerActivationProjection
{
	/** Identifies the represented agent identity. */
	readonly agentIdentityId: string;
	/** Identifies the release-admitted computer profile. */
	readonly profileRevisionId: string;
}

/**
 * Resolves the relational coordinates needed to address computer history and publishes its active lease.
 *
 * Activation publishes only after Kurrent accepts the Active event. The implementation must reject a
 * different row already stored for the same computer, because replacing it would let an earlier activation
 * authorize work against a later realization.
 *
 * Called by: {@link ConversationComputerActivationAuthority}.
 */
export interface ConversationComputerActivationProjectionRepository
{
	/** Resolves coordinates or returns null for a foreign or non-agent conversation. */
	resolve(command: ConversationComputerActivationCommand): Promise<ConversationComputerActivationProjection | null>;
	/** Publishes the active lease after Kurrent has accepted the Active event. */
	publishActiveLease(command: ConversationComputerActiveLeaseProjectionCommand): Promise<void>;
}

/**
 * Carries the active lease coordinates copied into PostgreSQL after activation succeeds.
 *
 * Deferred approval transactions compare every field with the immutable execution subject. A missing,
 * expired, or replaced row therefore prevents a tool action from being approved for a released sandbox.
 * Lifecycle renewal reuses the same command to move the projected expiry later.
 */
export interface ConversationComputerActiveLeaseProjectionCommand
{
	/** Names the silo, conversation, computer and agent identity the row is published for. */
	readonly computer: ComputerScope;
	/** Names the active lease, its generation and the instant it stops admitting approvals and effects. */
	readonly lease: ActiveLeaseScope;
}

/** Release-owned realization policy supplied to activation authority. */
export interface ConversationComputerActivationProfile
{
	/** Immutable image/profile revision admitted by the release. */
	readonly profileRevisionId: string;
	/** Profile name selected by the SandboxClaim. */
	readonly profileName: string;
	/** Warm pool fixed for this profile. */
	readonly warmPoolName: string;
	/** Isolated Agent Sandbox namespace. */
	readonly namespace: string;
	/** Maximum lifetime of one computer lease. */
	readonly leaseTtlMilliseconds: number;
}
