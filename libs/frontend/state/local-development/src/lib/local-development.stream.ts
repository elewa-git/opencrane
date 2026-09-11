import { __CreateConversationHistoryProjection, ConversationEventStreamStatuses, type ConversationEventStream, type StreamConversationEventsCommand } from "@opencrane/state/conversation/stream";

import type { _LocalDevelopmentState } from "./local-development.owner.types";
import { LocalDevelopmentScenarios } from "./local-development.types";

/** Delays the finite slow scenario without slowing every local interaction. */
function _Delay(milliseconds: number): Promise<void>
{
	return new Promise(function _Wait(resolve) { setTimeout(resolve, milliseconds); });
}

/** Creates deterministic live, slow, reconnecting, and access-changed stream behavior. */
export function _CreateLocalDevelopmentStream(state: _LocalDevelopmentState): ConversationEventStream
{
	return { stream: async function _Stream(command: StreamConversationEventsCommand)
	{
		const history = state.histories.get(command.conversationId) ?? __CreateConversationHistoryProjection();
		if (state.scenario === LocalDevelopmentScenarios.Slow)
		{
			await _Delay(80);
		}
		if (state.scenario === LocalDevelopmentScenarios.AccessChanged)
		{
			const empty = __CreateConversationHistoryProjection();
			command.onUpdate?.({ status: ConversationEventStreamStatuses.AccessChanged, state: empty, reconnectAttempt: 0, lastHeartbeatAt: Date.now() });
			return empty;
		}
		const reconnecting = state.scenario === LocalDevelopmentScenarios.Reconnecting;
		const status = reconnecting ? ConversationEventStreamStatuses.Reconnecting : ConversationEventStreamStatuses.Live;
		command.onUpdate?.({ status, state: history, reconnectAttempt: reconnecting ? 1 : 0, lastHeartbeatAt: Date.now() });
		return history;
	} };
}
