import { Injectable, inject } from "@angular/core";

import { ControlPlaneApiService } from "@opencrane/core";
import { __AgUiResumeCursor, __CreateAgUiStreamState, __DecodeAgUiSseRecord, __ReduceAgUiStream, type AgUiStreamState } from "@opencrane/state/conversation/ag-ui";

import { ConversationEventStreamStatuses, type ConversationEventStream, type ConversationEventStreamUpdate, type StreamConversationEventsCommand } from "./conversation-event-stream.types.js";

/** Maximum incomplete SSE frame retained between network chunks. */
const _MAXIMUM_FRAME_BYTES = 1_048_576;

/** Result of consuming one bounded SSE response. */
interface ConversationEventResponseResult
{
	/** Strictly reduced state at response completion. */
	readonly state: AgUiStreamState;
	/** Latest heartbeat time observed in this response. */
	readonly lastHeartbeatAt: number | null;
	/** Whether any durable or overlay event was reduced. */
	readonly receivedEvent: boolean;
}

/** Cookie-session incremental stream for the owner-bound conversation event endpoint. */
@Injectable()
export class OpenCraneConversationEventStream implements ConversationEventStream
{
	/** Generated Control Plane client carrying the browser's existing session cookie. */
	private readonly _api = inject(ControlPlaneApiService);

	/** @inheritdoc */
	public async stream(command: StreamConversationEventsCommand): Promise<AgUiStreamState>
	{
		_ValidateCommand(command);
		let state = command.initialState ?? __CreateAgUiStreamState();
		let reconnectAttempt = 0;
		let lastHeartbeatAt: number | null = null;
		_Emit(command, { status: ConversationEventStreamStatuses.Connecting, state, reconnectAttempt, lastHeartbeatAt });

		while (!command.signal.aborted)
		{
			try
			{
				const body = await this._open(command, state);
				_Emit(command, { status: ConversationEventStreamStatuses.Live, state, reconnectAttempt, lastHeartbeatAt });
				const result = await _ConsumeResponse(body, state, command, reconnectAttempt, lastHeartbeatAt);
				state = result.state;
				lastHeartbeatAt = result.lastHeartbeatAt;
				if (state.accessRevoked) throw new Error("conversation event access was revoked");
				if (result.receivedEvent) reconnectAttempt = 0;
			}
			catch (error)
			{
				if (command.signal.aborted) break;
				if (state.accessRevoked)
				{
					const message = _ErrorMessage(error);
					_Emit(command, { status: ConversationEventStreamStatuses.Failed, state, reconnectAttempt, lastHeartbeatAt, error: message });
					throw new Error(message, { cause: error });
				}
				reconnectAttempt += 1;
				if (reconnectAttempt > (command.maximumReconnectAttempts ?? 3))
				{
					const message = _ErrorMessage(error);
					_Emit(command, { status: ConversationEventStreamStatuses.Failed, state, reconnectAttempt, lastHeartbeatAt, error: message });
					throw new Error(message, { cause: error });
				}
			}

			if (!command.signal.aborted)
			{
				_Emit(command, { status: ConversationEventStreamStatuses.Reconnecting, state, reconnectAttempt, lastHeartbeatAt });
				await _Wait(command.reconnectDelayMilliseconds ?? 250, command.signal);
			}
		}

		_Emit(command, { status: ConversationEventStreamStatuses.Aborted, state, reconnectAttempt, lastHeartbeatAt });
		return state;
	}

	/** Open one bounded response with an exact server-issued resume cursor. */
	private async _open(command: StreamConversationEventsCommand, state: AgUiStreamState): Promise<ReadableStream<Uint8Array>>
	{
		const cursor = __AgUiResumeCursor(state);
		const { data, error } = await this._api.client.GET("/me/conversations/{conversationId}/events", {
			params: {
				path: { conversationId: command.conversationId },
				...(cursor === undefined ? {} : { query: { cursor }, header: { "Last-Event-ID": cursor } })
			},
			parseAs: "stream",
			signal: command.signal
		});
		if (error !== undefined || data === undefined || data === null) throw new Error("canonical conversation event stream is unavailable");
		return data;
	}
}

/** Incrementally decode arbitrary byte chunks into complete strict SSE records. */
async function _ConsumeResponse(body: ReadableStream<Uint8Array>, initialState: AgUiStreamState, command: StreamConversationEventsCommand, reconnectAttempt: number, priorHeartbeatAt: number | null): Promise<ConversationEventResponseResult>
{
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let state = initialState;
	let lastHeartbeatAt = priorHeartbeatAt;
	let receivedEvent = false;
	try
	{
		while (!command.signal.aborted)
		{
			const chunk = await reader.read();
			if (chunk.done) break;
			buffer += decoder.decode(chunk.value, { stream: true });
			if (buffer.length > _MAXIMUM_FRAME_BYTES) throw new Error("canonical conversation event frame exceeded its bound");
			const consumed = _ConsumeFrames(buffer, state, command, reconnectAttempt, lastHeartbeatAt);
			buffer = consumed.buffer;
			state = consumed.state;
			lastHeartbeatAt = consumed.lastHeartbeatAt;
			receivedEvent ||= consumed.receivedEvent;
		}
		buffer += decoder.decode();
		const consumed = _ConsumeFrames(buffer, state, command, reconnectAttempt, lastHeartbeatAt);
		buffer = consumed.buffer;
		state = consumed.state;
		lastHeartbeatAt = consumed.lastHeartbeatAt;
		receivedEvent ||= consumed.receivedEvent;
		if (!command.signal.aborted && buffer.trim().length > 0) throw new Error("canonical conversation event stream ended with an incomplete frame");
	}
	finally
	{
		await reader.cancel().catch(function _IgnoreClosedReader(): void { /* The response may already be closed. */ });
		_releaseReader(reader);
	}
	return { state, lastHeartbeatAt, receivedEvent };
}

/** Release a response reader after cancellation without retaining buffered bytes. */
function _releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>): void { reader.releaseLock(); }

/** Consume every complete LF or CRLF-delimited SSE frame currently buffered. */
function _ConsumeFrames(buffer: string, initialState: AgUiStreamState, command: StreamConversationEventsCommand, reconnectAttempt: number, priorHeartbeatAt: number | null): { readonly buffer: string; readonly state: AgUiStreamState; readonly lastHeartbeatAt: number | null; readonly receivedEvent: boolean }
{
	let remaining = buffer;
	let state = initialState;
	let lastHeartbeatAt = priorHeartbeatAt;
	let receivedEvent = false;
	while (true)
	{
		const boundary = /\r?\n\r?\n/u.exec(remaining);
		if (boundary === null || boundary.index === undefined) break;
		const frame = remaining.slice(0, boundary.index);
		remaining = remaining.slice(boundary.index + boundary[0].length);
		if (_IsHeartbeat(frame))
		{
			lastHeartbeatAt = Date.now();
			_Emit(command, { status: ConversationEventStreamStatuses.Live, state, reconnectAttempt, lastHeartbeatAt });
			continue;
		}
		const record = __DecodeAgUiSseRecord(frame);
		if (record === null) throw new Error("invalid canonical conversation event record");
		state = __ReduceAgUiStream(state, record);
		receivedEvent = true;
		_Emit(command, { status: ConversationEventStreamStatuses.Live, state, reconnectAttempt, lastHeartbeatAt });
	}
	return { buffer: remaining, state, lastHeartbeatAt, receivedEvent };
}

/** Accept only comment-only SSE frames as transport heartbeats. */
function _IsHeartbeat(frame: string): boolean
{
	const lines = frame.replaceAll("\r\n", "\n").split("\n").filter(line => line.length > 0);
	return lines.length > 0 && lines.every(line => line.startsWith(":"));
}

/** Notify a consumer after each observable stream-state transition. */
function _Emit(command: StreamConversationEventsCommand, update: ConversationEventStreamUpdate): void
{
	command.onUpdate?.(update);
}

/** Wait between reconnects while making caller abort immediate. */
async function _Wait(milliseconds: number, signal: AbortSignal): Promise<void>
{
	if (signal.aborted || milliseconds === 0) return;
	await new Promise<void>(function _Until(resolve)
	{
		const timeout = setTimeout(resolve, milliseconds);
		signal.addEventListener("abort", function _Abort(): void { clearTimeout(timeout); resolve(); }, { once: true });
	});
}

/** Reject invalid caller-controlled stream coordinates before issuing a request. */
function _ValidateCommand(command: StreamConversationEventsCommand): void
{
	if (command.conversationId.trim().length === 0) throw new Error("conversation id is required");
	if (command.maximumReconnectAttempts !== undefined && (!Number.isSafeInteger(command.maximumReconnectAttempts) || command.maximumReconnectAttempts < 0 || command.maximumReconnectAttempts > 10)) throw new Error("maximum reconnect attempts must be between zero and ten");
	if (command.reconnectDelayMilliseconds !== undefined && (!Number.isSafeInteger(command.reconnectDelayMilliseconds) || command.reconnectDelayMilliseconds < 0 || command.reconnectDelayMilliseconds > 30_000)) throw new Error("reconnect delay must be between zero and thirty seconds");
}

/** Reduce an unknown thrown value to a safe transport message. */
function _ErrorMessage(error: unknown): string
{
	return error instanceof Error ? error.message : "canonical conversation event stream failed";
}
