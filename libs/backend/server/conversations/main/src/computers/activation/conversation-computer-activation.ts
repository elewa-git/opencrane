import { setTimeout as _Sleep } from "node:timers/promises";

import type { HistoryPersistentRecordedEvent, HistoryPersistentSubscription } from "@opencrane/backend/server/infra/history-store";

import { ConversationComputerActivationConsumerEventKinds, ConversationComputerActivationConsumerStates, ConversationComputerActivationQueueActions, type ConversationComputerActivationAuthority, type ConversationComputerActivationCommand, type ConversationComputerActivationConsumer, type ConversationComputerActivationConsumerEvent, type ConversationComputerActivationConsumerHealth, type ConversationComputerActivationConsumerOptions, type ConversationComputerActivationListenerOptions, type ConversationComputerActivationOutcome, type ConversationComputerActivationResubscribePolicy } from "./conversation-computer-activation.types";

const _ACTIVATION_EVENT_TYPE = "opencrane.computer.activation-requested.v1";
/** First wait before a not-ready or transiently failed delivery is handed back for redelivery. */
const _RETRY_BASE_MILLISECONDS = 1_000;
/**
 * Longest single wait while holding one delivery.
 *
 * The provisioned group has a 60 second message timeout; staying at ten seconds keeps the held
 * delivery far from that limit so KurrentDB never redelivers an event the listener still holds.
 */
const _RETRY_MAX_MILLISECONDS = 10_000;
/**
 * Default reopen policy for a dropped persistent subscription.
 *
 * Twenty consecutive drops with a 30 second cap add up to roughly eight minutes of a KurrentDB outage
 * before one replica gives up. That is long enough to ride out a KurrentDB restart and short enough
 * that a replica which can never subscribe again is replaced by Kubernetes within one incident.
 */
export const _DEFAULT_RESUBSCRIBE_POLICY: ConversationComputerActivationResubscribePolicy = { baseMilliseconds: 1_000, maxMilliseconds: 30_000, maxConsecutiveFailures: 20, healthySessionMilliseconds: 60_000 };
/** Marks that the stop signal won the race against the next delivery. */
const _STOPPED = Symbol("conversation computer activation consumer stopped");

/**
 * Returns the bounded exponential wait for one redelivery.
 *
 * With a 60 retry budget the waits sum to well over nine minutes before a delivery parks, which
 * covers a slow gVisor cold start while still parking a claim that never converges.
 * @param retryCount - Number of times KurrentDB has already redelivered this event.
 */
export function _ActivationRetryDelayMilliseconds(retryCount: number): number
{
	const attempt = Number.isSafeInteger(retryCount) && retryCount > 0 ? retryCount : 0;
	return Math.min(_RETRY_BASE_MILLISECONDS * 2 ** attempt, _RETRY_MAX_MILLISECONDS);
}

/**
 * Resolves one persistent computer-activation delivery through its explicit queue action.
 *
 * A malformed stream-bound command is parked before it reaches authority. A pending sandbox and a
 * transient authority failure both wait with bounded backoff and then retry, while a terminal
 * authority outcome chooses acknowledge or park. A failed queue action propagates so KurrentDB
 * retains responsibility for redelivery.
 * @param subscription - Provides the delivery action that resolves this event.
 * @param authority - Decides the current computer-generation activation outcome.
 * @param delivery - Carries the at-least-once persistent delivery to validate and resolve.
 * @param options - Replaces the clock wait in tests.
 * @throws {Error} Propagates a failed acknowledgement, retry, or park action.
 */
export async function __ConsumeConversationComputerActivation(subscription: Pick<HistoryPersistentSubscription, "acknowledge" | "park" | "retry">, authority: ConversationComputerActivationAuthority, delivery: HistoryPersistentRecordedEvent, options: ConversationComputerActivationListenerOptions = {}): Promise<void>
{
	const command = _ActivationCommand(delivery);
	if (command === null)
	{
		await subscription.park(delivery, "invalid conversation computer activation event");
		return;
	}
	const outcome = await _Outcome(authority, command);
	if (typeof outcome === "string")
	{
		await subscription.acknowledge(delivery);
		return;
	}
	if (outcome.action === ConversationComputerActivationQueueActions.Park)
	{
		await subscription.park(delivery, outcome.reason);
		return;
	}
	// Shutdown cuts the wait short so the held delivery goes back to the group immediately.
	await (options.wait ?? _Wait)(_ActivationRetryDelayMilliseconds(delivery.retryCount), options.signal);
	await subscription.retry(delivery, outcome.reason);
}

/** Turn an authority exception into the retry outcome so only queue-action failures propagate. */
async function _Outcome(authority: ConversationComputerActivationAuthority, command: ConversationComputerActivationCommand): Promise<ConversationComputerActivationOutcome>
{
	try
	{
		return await authority.activate(command);
	}
	catch
	{
		return { action: ConversationComputerActivationQueueActions.Retry, reason: "conversation computer activation authority unavailable" };
	}
}

/**
 * Processes one computer-activation subscription sequentially until its event stream ends.
 *
 * Sequential consumption preserves the subscription's delivery order and stops when any delivery
 * action fails, leaving that action to the persistent subscription's redelivery behavior.
 * @param subscription - Supplies ordered persistent deliveries and their terminal actions.
 * @param authority - Decides each validated computer activation.
 * @param options - Replaces the clock wait in tests.
 * @throws {Error} Propagates a delivery-resolution failure.
 */
export async function __RunConversationComputerActivationListener(subscription: Pick<HistoryPersistentSubscription, "acknowledge" | "events" | "park" | "retry">, authority: ConversationComputerActivationAuthority, options: ConversationComputerActivationListenerOptions = {}): Promise<void>
{
	for await (const delivery of subscription.events)
		await __ConsumeConversationComputerActivation(subscription, authority, delivery, options);
}

/**
 * Runs one competing consumer for the silo activation queue and keeps it subscribed.
 *
 * Every opencrane-server replica starts one of these against the same consumer group. Deliveries are
 * handled sequentially inside a replica; across replicas KurrentDB shares them round-robin. That is
 * safe because the authority fences every write with an expected revision and a deterministic claim
 * name, so two replicas handling the same computer converge instead of double-activating.
 *
 * A dropped or ended subscription, or a failed queue action, closes the session and reopens it after
 * a jittered wait. Once the consecutive-failure budget is used the consumer reports `Failed` and
 * stops; the composition decides how the process reacts. Aborting the signal stops pulling new
 * deliveries, lets the in-flight delivery finish or hand itself back, and then closes the subscription.
 *
 * Called by: conversation-computer-activation-composition.ts.
 * @param open - Opens one fresh persistent subscription; called again after every drop.
 * @param authority - Decides each validated computer activation.
 * @param options - Supplies the stop signal, reopen policy, event hook, and test seams.
 * @returns The consumer handle with its completion promise and health snapshot.
 */
export function __StartConversationComputerActivationConsumer(open: () => Promise<HistoryPersistentSubscription>, authority: ConversationComputerActivationAuthority, options: ConversationComputerActivationConsumerOptions): ConversationComputerActivationConsumer
{
	const health = { state: ConversationComputerActivationConsumerStates.Starting, consecutiveFailures: 0 };
	const done = _Supervise(open, authority, options, health).catch(function _SupervisorFailed(error: unknown)
	{
		health.state = ConversationComputerActivationConsumerStates.Failed;
		options.onEvent?.({ kind: ConversationComputerActivationConsumerEventKinds.Failed, error, consecutiveFailures: health.consecutiveFailures });
	});
	return { done, health: function _Health(): ConversationComputerActivationConsumerHealth { return { ...health }; } };
}

/** Reopens the subscription after each drop until the stop signal fires or the budget is used. */
async function _Supervise(open: () => Promise<HistoryPersistentSubscription>, authority: ConversationComputerActivationAuthority, options: ConversationComputerActivationConsumerOptions, health: { state: ConversationComputerActivationConsumerStates; consecutiveFailures: number }): Promise<void>
{
	const policy = { ..._DEFAULT_RESUBSCRIBE_POLICY, ...options.resubscribe };
	const now = options.now ?? Date.now;
	while (!options.signal.aborted)
	{
		const startedAt = now();
		const session = await _RunSession(open, authority, options, health);
		if (options.signal.aborted)
			break;
		// A session that delivered work or stayed open long enough proves KurrentDB was healthy, so
		// earlier drops stop counting toward the budget.
		if (session.deliveries > 0 || now() - startedAt >= policy.healthySessionMilliseconds)
			health.consecutiveFailures = 0;
		health.consecutiveFailures += 1;
		if (health.consecutiveFailures >= policy.maxConsecutiveFailures)
		{
			health.state = ConversationComputerActivationConsumerStates.Failed;
			options.onEvent?.({ kind: ConversationComputerActivationConsumerEventKinds.Failed, error: session.error, consecutiveFailures: health.consecutiveFailures });
			return;
		}
		health.state = ConversationComputerActivationConsumerStates.Reconnecting;
		const nextWaitMilliseconds = _ResubscribeDelayMilliseconds(health.consecutiveFailures, policy, options.random ?? Math.random);
		options.onEvent?.({ kind: ConversationComputerActivationConsumerEventKinds.Dropped, error: session.error, consecutiveFailures: health.consecutiveFailures, nextWaitMilliseconds });
		await (options.wait ?? _Wait)(nextWaitMilliseconds, options.signal);
	}
	health.state = ConversationComputerActivationConsumerStates.Stopped;
	options.onEvent?.({ kind: ConversationComputerActivationConsumerEventKinds.Stopped });
}

/** Opens one subscription and handles deliveries until it drops, ends, or the stop signal fires. */
async function _RunSession(open: () => Promise<HistoryPersistentSubscription>, authority: ConversationComputerActivationAuthority, options: ConversationComputerActivationConsumerOptions, health: { state: ConversationComputerActivationConsumerStates }): Promise<{ readonly deliveries: number; readonly error: unknown }>
{
	let subscription: HistoryPersistentSubscription;
	try
	{
		subscription = await open();
	}
	catch (error)
	{
		return { deliveries: 0, error };
	}
	health.state = ConversationComputerActivationConsumerStates.Subscribed;
	options.onEvent?.({ kind: ConversationComputerActivationConsumerEventKinds.Subscribed });
	let deliveries = 0;
	const stopped = _Stopped(options.signal);
	try
	{
		const iterator = subscription.events[Symbol.asyncIterator]();
		while (!options.signal.aborted)
		{
			// Racing the stop signal lets an idle consumer leave without waiting for a delivery that may never come.
			const next = await Promise.race([iterator.next(), stopped.promise]);
			if (next === _STOPPED)
				break;
			if (next.done)
				return { deliveries, error: new Error("conversation computer activation subscription ended") };
			deliveries += 1;
			// A delivery already in hand finishes (or hands itself back) before the loop checks the signal again.
			await __ConsumeConversationComputerActivation(subscription, authority, next.value, options);
		}
		return { deliveries, error: null };
	}
	catch (error)
	{
		return { deliveries, error };
	}
	finally
	{
		stopped.release();
		await subscription.close().catch(function _CloseFailed() { /* The session is over either way; the drop or stop already carries the reason. */ });
	}
}

/** Resolves with the stop marker once the signal aborts; `release` detaches the listener afterwards. */
function _Stopped(signal: AbortSignal): { readonly promise: Promise<typeof _STOPPED>; readonly release: () => void }
{
	let release = function _NoListener(): void {};
	const promise = new Promise<typeof _STOPPED>(function _AwaitStop(resolve)
	{
		if (signal.aborted)
		{
			resolve(_STOPPED);
			return;
		}
		const onAbort = function _OnAbort(): void { resolve(_STOPPED); };
		signal.addEventListener("abort", onAbort, { once: true });
		release = function _Release(): void { signal.removeEventListener("abort", onAbort); };
	});
	return { promise, release: function _ReleaseListener(): void { release(); } };
}

/**
 * Returns the jittered exponential wait before one subscription attempt.
 *
 * Jitter spreads the reconnects of several replicas across a window so KurrentDB does not receive
 * every subscribe request in the same instant after it comes back.
 * @param consecutiveFailures - Drops since the last healthy session, starting at one.
 * @param policy - Base, cap, and budget for the wait.
 * @param random - Supplies a number in [0, 1).
 */
export function _ResubscribeDelayMilliseconds(consecutiveFailures: number, policy: ConversationComputerActivationResubscribePolicy, random: () => number): number
{
	const attempt = Number.isSafeInteger(consecutiveFailures) && consecutiveFailures > 0 ? consecutiveFailures - 1 : 0;
	const nominal = Math.min(policy.baseMilliseconds * 2 ** attempt, policy.maxMilliseconds);
	// Spread each wait across 75% to 125% of its nominal value.
	return Math.round(nominal * (0.75 + random() * 0.5));
}

/** Waits on the process timer without keeping the event loop alive; an aborted signal ends the wait early. */
async function _Wait(milliseconds: number, signal?: AbortSignal): Promise<void>
{
	if (signal?.aborted)
		return;
	try
	{
		await _Sleep(milliseconds, undefined, { ref: false, signal });
	}
	catch (error)
	{
		if (signal?.aborted)
			return;
		throw error;
	}
}

/** Validates a silo-scoped activation queue event before it reaches computer authority. */
function _ActivationCommand(delivery: HistoryPersistentRecordedEvent): ConversationComputerActivationCommand | null
{
	if (delivery.type !== _ACTIVATION_EVENT_TYPE || !delivery.streamName.startsWith("computer-activations-"))
		return null;
	const siloId = delivery.data["siloId"];
	const computerId = delivery.data["computerId"];
	const conversationId = delivery.data["conversationId"];
	const generation = delivery.data["generation"];
	if (typeof siloId !== "string" || siloId.length === 0 || delivery.streamName !== `computer-activations-${siloId}` || typeof computerId !== "string" || computerId.length === 0 || typeof conversationId !== "string" || conversationId.length === 0 || typeof generation !== "number" || !Number.isSafeInteger(generation) || generation < 1)
		return null;
	return { siloId, computerId, conversationId, generation };
}
