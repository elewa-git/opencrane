import { Injectable, inject } from "@angular/core";

import { ControlPlaneApiService } from "@opencrane/core";
import { __CreateConversationHistoryProjection, __ParseConversationHistoryProjection, ConversationEventStreamStatuses, type ConversationEventStream, type ConversationEventStreamUpdate, type ConversationHistoryProjection, type StreamConversationEventsCommand } from "@opencrane/state/conversation/stream";

import { _ReadConversationEventFrames } from "./conversation-event-decoder";
import { _ConversationResponseError, ConversationTransportError } from "./conversation-event-transport.errors";
import { ConversationServerErrors, ConversationServerEvents, ConversationTransportFailureKinds, type ConversationServerFrame } from "./conversation-event-transport.types";

/** Refreshes computer state through the existing history API until that projection has its own event. */
const _COMPUTER_REFRESH_MILLISECONDS = 30_000;
/** Prevents short, normally completed responses from creating an immediate reconnect loop. */
const _MINIMUM_CONNECTION_INTERVAL_MILLISECONDS = 5_000;

/** Follows participant history through the generated, session-authenticated SSE client. */
@Injectable()
export class OpenCraneConversationEventStream implements ConversationEventStream
{
	/** Generated API client whose same-origin session identifies the participant. */
	private readonly _api = inject(ControlPlaneApiService);

	/** Reads initial history, follows new events, and stops when selection or current access ends. */
	public async stream(command: StreamConversationEventsCommand): Promise<ConversationHistoryProjection>
	{
		_ValidateCommand(command);
		let state = command.initialState ?? __CreateConversationHistoryProjection();
		let reconnectAttempt = 0;
		let lastHeartbeatAt: number | null = null;
		let refreshAt = 0;
		let connectionStartedAt = 0;
		_Emit(command, { status: ConversationEventStreamStatuses.Connecting, state, reconnectAttempt, lastHeartbeatAt });

		while (!command.signal.aborted)
		{
			try
			{
				if (Date.now() >= refreshAt)
				{
					const afterPosition = state.nextPosition === "0" && state.entries.length === 0 ? undefined : state.nextPosition;
					const next = await this._Read(command, afterPosition);
					if (command.signal.aborted)
						break;
					state = _Merge(state, _Projection(next, command.conversationId, state.nextPosition), false);
					refreshAt = Date.now() + _COMPUTER_REFRESH_MILLISECONDS;
				}

				await _Wait(Math.max(0, connectionStartedAt + _MINIMUM_CONNECTION_INTERVAL_MILLISECONDS - Date.now()), command.signal);
				if (command.signal.aborted)
					break;
				connectionStartedAt = Date.now();
				for await (const frame of this._Connect(command, state.nextPosition, refreshAt))
				{
					if (command.signal.aborted)
						break;
					if (frame !== null)
					{
						state = _AdoptFrame(frame, state, command.conversationId);
						reconnectAttempt = 0;
					}
					lastHeartbeatAt = Date.now();
					_Emit(command, { status: ConversationEventStreamStatuses.Live, state, reconnectAttempt, lastHeartbeatAt });
				}
				// Duration, idle, and response-size limits end healthy server responses without consuming retries.
				reconnectAttempt = 0;
			}
			catch (error)
			{
				if (command.signal.aborted)
					break;
				if (error instanceof ConversationTransportError && error.kind === ConversationTransportFailureKinds.AccessChanged)
				{
					state = __CreateConversationHistoryProjection();
					_Emit(command, { status: ConversationEventStreamStatuses.AccessChanged, state, reconnectAttempt, lastHeartbeatAt });
					return state;
				}
				reconnectAttempt += 1;
				if ((error instanceof ConversationTransportError && error.kind === ConversationTransportFailureKinds.InvalidResponse)
					|| reconnectAttempt > (command.maximumReconnectAttempts ?? 3))
					_Fail(command, state, reconnectAttempt, lastHeartbeatAt);
				_Emit(command, { status: ConversationEventStreamStatuses.Reconnecting, state, reconnectAttempt, lastHeartbeatAt });
				const retryAfter = error instanceof ConversationTransportError ? error.retryAfterMilliseconds : 0;
				const backoff = Math.min(30_000, (command.reconnectDelayMilliseconds ?? 1_000) * 2 ** (reconnectAttempt - 1));
				await _Wait(Math.max(retryAfter, backoff), command.signal);
			}
		}

		_Emit(command, { status: ConversationEventStreamStatuses.Aborted, state, reconnectAttempt, lastHeartbeatAt });
		return state;
	}

	/** Uses the existing history response for initial catch-up and periodic computer refresh. */
	private async _Read(command: StreamConversationEventsCommand, afterPosition: string | undefined): Promise<unknown>
	{
		const conversationId = command.conversationId;
		const params = afterPosition === undefined ? { path: { conversationId } } : { path: { conversationId }, query: { afterPosition } };
		const result = await this._api.client.GET("/me/conversations/{conversationId}/history", { params, signal: command.signal });
		if (command.signal.aborted)
			return undefined;
		if (result.error !== undefined || result.data === undefined)
			throw _ConversationResponseError(result.response);
		return result.data;
	}

	/** Opens one cancellable SSE response and releases it before the next computer refresh. */
	private async* _Connect(command: StreamConversationEventsCommand, afterPosition: string, refreshAt: number): AsyncGenerator<ConversationServerFrame | null>
	{
		const abort = new AbortController();
		function _Stop(): void { abort.abort(); }
		const timeout = setTimeout(_Stop, Math.max(0, refreshAt - Date.now()));
		command.signal.addEventListener("abort", _Stop, { once: true });
		try
		{
			if (command.signal.aborted)
				return;
			const result = await this._api.client.GET("/me/conversations/{conversationId}/events", {
				params: { path: { conversationId: command.conversationId }, query: { afterPosition } },
				headers: { Accept: "text/event-stream", "Last-Event-ID": afterPosition },
				parseAs: "stream", signal: abort.signal
			});
			if (abort.signal.aborted)
			{
				await result.data?.cancel();
				return;
			}
			if (result.error !== undefined || result.data === undefined || result.data === null)
				throw _ConversationResponseError(result.response);
			if (result.response.headers.get("Content-Type")?.split(";")[0]?.trim() !== "text/event-stream")
				throw new ConversationTransportError(ConversationTransportFailureKinds.InvalidResponse);
			// The authenticated response has opened; a quiet chat is live before its first event arrives.
			yield null;
			yield* _ReadConversationEventFrames(result.data, abort.signal);
		}
		catch (error)
		{
			if (!abort.signal.aborted)
				throw error;
		}
		finally
		{
			clearTimeout(timeout);
			command.signal.removeEventListener("abort", _Stop);
			abort.abort();
		}
	}
}

/** Validates a decoded page and converts integrity failures to a terminal transport decision. */
function _Projection(value: unknown, conversationId: string, previousPosition: string): ConversationHistoryProjection
{
	try { return __ParseConversationHistoryProjection(value, conversationId, previousPosition); }
	catch { throw new ConversationTransportError(ConversationTransportFailureKinds.InvalidResponse); }
}

/** Applies a history checkpoint or interprets a fixed terminal server event. */
function _AdoptFrame(frame: ConversationServerFrame, current: ConversationHistoryProjection, conversationId: string): ConversationHistoryProjection
{
	if (frame.event === undefined)
		return current;
	let value: unknown;
	try { value = JSON.parse(frame.data); }
	catch { throw new ConversationTransportError(ConversationTransportFailureKinds.InvalidResponse); }
	if (frame.event === ConversationServerEvents.Unavailable)
	{
		const error = typeof value === "object" && value !== null ? (value as Record<string, unknown>)["error"] : undefined;
		const kind = error === ConversationServerErrors.AccessChanged ? ConversationTransportFailureKinds.AccessChanged : ConversationTransportFailureKinds.InvalidResponse;
		throw new ConversationTransportError(kind);
	}
	const next = _Projection(value, conversationId, current.nextPosition);
	if (frame.id !== next.nextPosition || next.computer !== null)
		throw new ConversationTransportError(ConversationTransportFailureKinds.InvalidResponse);
	return _Merge(current, next, true);
}

/** Appends unseen entries while SSE preserves the computer last read through the history API. */
function _Merge(current: ConversationHistoryProjection, next: ConversationHistoryProjection, preserveComputer: boolean): ConversationHistoryProjection
{
	const positions = new Set(current.entries.map(entry => entry.position));
	const entries = [...current.entries, ...next.entries.filter(entry => !positions.has(entry.position))];
	return { entries, payloads: { ...current.payloads, ...next.payloads }, nextPosition: next.nextPosition, computer: preserveComputer ? current.computer : next.computer };
}

/** Rejects invalid retry options before the first authenticated request. */
function _ValidateCommand(command: StreamConversationEventsCommand): void
{
	if (command.conversationId.trim().length === 0)
		throw new Error("conversation id is required");
	if (command.maximumReconnectAttempts !== undefined && (!Number.isSafeInteger(command.maximumReconnectAttempts)
		|| command.maximumReconnectAttempts < 0 || command.maximumReconnectAttempts > 10))
		throw new Error("maximum reconnect attempts must be between zero and ten");
	if (command.reconnectDelayMilliseconds !== undefined && (!Number.isSafeInteger(command.reconnectDelayMilliseconds)
		|| command.reconnectDelayMilliseconds < 0 || command.reconnectDelayMilliseconds > 60_000))
		throw new Error("reconnect delay must be between zero and sixty thousand milliseconds");
}

/** Waits without retaining abort listeners after a timer finishes. */
async function _Wait(milliseconds: number, signal: AbortSignal): Promise<void>
{
	if (signal.aborted || milliseconds === 0)
		return;
	await new Promise<void>(function _Until(resolve)
	{
		function _Done(): void
		{
			clearTimeout(timeout);
			signal.removeEventListener("abort", _Done);
			resolve();
		}
		const timeout = setTimeout(_Done, milliseconds);
		signal.addEventListener("abort", _Done, { once: true });
	});
}

/** Publishes accepted progress unless the caller already changed selection. */
function _Emit(command: StreamConversationEventsCommand, update: ConversationEventStreamUpdate): void
{
	if (!command.signal.aborted || update.status === ConversationEventStreamStatuses.Aborted)
		command.onUpdate?.(update);
}

/** Stops retries while retaining accepted history and exposing fixed browser-safe copy. */
function _Fail(command: StreamConversationEventsCommand, state: ConversationHistoryProjection, reconnectAttempt: number, lastHeartbeatAt: number | null): never
{
	_Emit(command, { status: ConversationEventStreamStatuses.Failed, state, reconnectAttempt, lastHeartbeatAt, error: "Conversation history is unavailable." });
	throw new Error("Conversation history is unavailable.");
}
