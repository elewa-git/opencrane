import { Injectable, inject } from "@angular/core";
import { EventType } from "@ag-ui/core";

import type { AgUiProjectionEvent } from "@opencrane/contracts";
import { ConversationModes, MessageContentBlockKinds } from "@opencrane/models/conversations";
import { __CreateAgUiStreamState, __ReduceAgUiStream, type AgUiStreamRecord, type AgUiStreamState } from "@opencrane/state/conversation/ag-ui";
import { ConversationEventStreamMessageError, ConversationEventStreamStatuses, type ConversationEventStream, type StreamConversationEventsCommand, type SubmitConversationEventStreamMessageCommand } from "@opencrane/state/conversation/stream";
import { ConversationWorkspaceGatewayError, ConversationWorkspaceGatewayErrorKinds, type SubmitConversationMessageBlock } from "@opencrane/state/conversation/workspace";

import { LocalDevelopmentScenarioKinds } from "./local-development-scenario.types";
import { LocalDevelopmentState } from "./local-development-state";
import { LocalDevelopmentConversationWorkspaceGateway } from "./local-development-workspace.gateway";

/**
 * Emits deterministic Agent-run events through the reducer also used by the live SSE adapter.
 * Agent sessions receive progress and a terminal outcome; direct and group conversations receive a
 * live connection update without a fabricated run.
 *
 * @see https://docs.ag-ui.com — the event protocol exercised by this local stream.
 */
@Injectable()
export class LocalDevelopmentConversationEventStream implements ConversationEventStream
{
	/** Shared scenario selection used for reconnecting and failed-run projections. */
	private readonly _state = inject(LocalDevelopmentState);
	/** Local command owner that admits a stream submission into the shared conversation projection. */
	private readonly _workspace = inject(LocalDevelopmentConversationWorkspaceGateway);

	/** Emit a finite deterministic progress sequence, then remain open until the caller aborts. */
	public async stream(command: StreamConversationEventsCommand): Promise<AgUiStreamState>
	{
		let state = command.initialState ?? __CreateAgUiStreamState();
		const conversation = this._state.conversations.get(command.conversationId);

		if (!conversation)
		{
			throw new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.AccessChanged, "This conversation is unavailable.");
		}

		command.onUpdate?.({
			status: ConversationEventStreamStatuses.Connecting,
			state,
			reconnectAttempt: 0,
			lastHeartbeatAt: null
		});

		if (this._state.scenario === LocalDevelopmentScenarioKinds.Reconnecting)
		{
			command.onUpdate?.({
				status: ConversationEventStreamStatuses.Reconnecting,
				state,
				reconnectAttempt: 1,
				lastHeartbeatAt: null
			});
		}

		const events = conversation.mode === ConversationModes.AgentSession ? this._AgentEvents(command.conversationId) : [];
		for (const [index, event] of events.entries())
		{
			state = __ReduceAgUiStream(state, _Record(`local-cursor-${index + 1}`, event));
			command.onUpdate?.({
				status: ConversationEventStreamStatuses.Live,
				state,
				reconnectAttempt: 0,
				lastHeartbeatAt: 1787306400000
			});
			await Promise.resolve();
		}

		if (!events.length)
		{
			command.onUpdate?.({
				status: ConversationEventStreamStatuses.Live,
				state,
				reconnectAttempt: 0,
				lastHeartbeatAt: 1787306400000
			});
		}

		if (!command.signal.aborted)
		{
			await new Promise<void>(function _UntilAbort(resolve): void
			{
				command.signal.addEventListener("abort", function _Resolve(): void
				{
					resolve();
				}, { once: true });
			});
		}

		command.onUpdate?.({
			status: ConversationEventStreamStatuses.Aborted,
			state,
			reconnectAttempt: 0,
			lastHeartbeatAt: 1787306400000
		});
		return state;
	}

	/** Admit a participant message through the same shared local workspace used by routed commands. */
	public async submit(command: SubmitConversationEventStreamMessageCommand): Promise<void>
	{
		const blocks = command.blocks.map(function _Block(block): SubmitConversationMessageBlock
		{
			if (block.kind !== MessageContentBlockKinds.Text && block.kind !== MessageContentBlockKinds.Artifact)
			{
				throw new ConversationEventStreamMessageError();
			}

			return {
				id: block.id,
				kind: block.kind,
				value: block.value
			};
		});

		try
		{
			await this._workspace.send({
				conversationId: command.conversationId,
				idempotencyKey: command.idempotencyKey,
				blocks
			});
		}
		catch (error)
		{
			if (error instanceof ConversationWorkspaceGatewayError && error.kind === ConversationWorkspaceGatewayErrorKinds.AccessChanged)
			{
				throw new ConversationEventStreamMessageError("conversation_unavailable");
			}

			if (error instanceof ConversationWorkspaceGatewayError && error.kind === ConversationWorkspaceGatewayErrorKinds.Conflict)
			{
				throw new ConversationEventStreamMessageError("conversation_closed");
			}

			throw new ConversationEventStreamMessageError();
		}
	}

	/** Build an Agent-only stream with the run owned by the selected conversation. */
	private _AgentEvents(conversationId: string): readonly AgUiProjectionEvent[]
	{
		const runId = this._state.runForConversation(conversationId)?.runId;

		if (!runId)
		{
			throw new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.Unavailable, "This Agent conversation has no active run.");
		}

		return [
			{
				type: EventType.RUN_STARTED,
				threadId: conversationId,
				runId
			},
			{
				type: EventType.TEXT_MESSAGE_START,
				messageId: `stream-message-${runId}`,
				role: "assistant"
			},
			{
				type: EventType.TEXT_MESSAGE_CONTENT,
				messageId: `stream-message-${runId}`,
				delta: "I’m checking the dependencies and will recommend the shortest reliable path."
			},
			{
				type: EventType.TEXT_MESSAGE_END,
				messageId: `stream-message-${runId}`
			},
			_TerminalEvent(this._state.scenario, conversationId, runId)
		];
	}
}

/** Wrap a projection event in the cursor record expected by the shared stream reducer. */
function _Record(id: string, data: AgUiProjectionEvent): AgUiStreamRecord
{
	return {
		id,
		event: "ag-ui",
		data
	};
}

/** Select one terminal run event from the allowlisted local scenario. */
function _TerminalEvent(scenario: LocalDevelopmentScenarioKinds, conversationId: string, runId: string): AgUiProjectionEvent
{
	if (scenario === LocalDevelopmentScenarioKinds.FailedRun)
	{
		return {
			type: EventType.RUN_ERROR,
			message: "The Agent run ended before it completed. Retry to continue.",
			code: "LOCAL_SCENARIO_FAILURE"
		};
	}

	return {
		type: EventType.RUN_FINISHED,
		threadId: conversationId,
		runId,
		outcome: { type: "success" }
	};
}
