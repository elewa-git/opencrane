import type { HistoryPersistentRecordedEvent, HistoryPersistentSubscription } from "@opencrane/backend/server/infra/history-store";

import type { ConversationComputerActivationAuthority, ConversationComputerActivationCommand } from "./conversation-computer-activation.types";

const _ACTIVATION_EVENT_TYPE = "opencrane.computer.activation-requested.v1";

/**
 * Resolves one persistent computer-activation delivery through its explicit queue action.
 *
 * A malformed stream-bound command is parked before it reaches authority. A transient authority
 * failure retries, while a terminal authority outcome chooses acknowledge or park. A failed queue
 * action propagates so KurrentDB retains responsibility for redelivery.
 * @param subscription - Provides the delivery action that resolves this event.
 * @param authority - Decides the current computer-generation activation outcome.
 * @param delivery - Carries the at-least-once persistent delivery to validate and resolve.
 * @throws {Error} Propagates a failed acknowledgement, retry, or park action.
 */
export async function __ConsumeConversationComputerActivation(subscription: Pick<HistoryPersistentSubscription, "acknowledge" | "park" | "retry">, authority: ConversationComputerActivationAuthority, delivery: HistoryPersistentRecordedEvent): Promise<void>
{
	const command = _ActivationCommand(delivery);
	if (command === null)
	{
		await subscription.park(delivery, "invalid conversation computer activation event");
		return;
	}
	try
	{
		const outcome = await authority.activate(command);
		if (typeof outcome !== "string")
		{
			await subscription.park(delivery, outcome.reason);
			return;
		}
	}
	catch
	{
		await subscription.retry(delivery, "conversation computer activation authority unavailable");
		return;
	}
	await subscription.acknowledge(delivery);
}

/**
 * Processes one computer-activation subscription sequentially until its event stream ends.
 *
 * Sequential consumption preserves the subscription's delivery order and stops when any delivery
 * action fails, leaving that action to the persistent subscription's redelivery behavior.
 * @param subscription - Supplies ordered persistent deliveries and their terminal actions.
 * @param authority - Decides each validated computer activation.
 * @throws {Error} Propagates a delivery-resolution failure.
 */
export async function __RunConversationComputerActivationListener(subscription: Pick<HistoryPersistentSubscription, "acknowledge" | "events" | "park" | "retry">, authority: ConversationComputerActivationAuthority): Promise<void>
{
	for await (const delivery of subscription.events)
		await __ConsumeConversationComputerActivation(subscription, authority, delivery);
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
