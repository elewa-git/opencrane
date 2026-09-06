import { setTimeout as _Sleep } from "node:timers/promises";

import type { HistoryPersistentRecordedEvent, HistoryPersistentSubscription } from "@opencrane/backend/server/infra/history-store";

import { ConversationComputerActivationQueueActions, type ConversationComputerActivationAuthority, type ConversationComputerActivationCommand, type ConversationComputerActivationListenerOptions, type ConversationComputerActivationOutcome } from "./conversation-computer-activation.types";

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
	await (options.wait ?? _Wait)(_ActivationRetryDelayMilliseconds(delivery.retryCount));
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

/** Waits on the process timer without keeping the event loop alive for the wait alone. */
async function _Wait(milliseconds: number): Promise<void>
{
	await _Sleep(milliseconds, undefined, { ref: false });
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
