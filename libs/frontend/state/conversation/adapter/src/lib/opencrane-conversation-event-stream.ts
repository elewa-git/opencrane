import { Injectable, inject } from "@angular/core";

import { ControlPlaneApiService } from "@opencrane/core";
import { __AgUiResumeCursor, __CreateAgUiStreamState, __DecodeAgUiSseRecord, __ReduceAgUiStream, __RevokeAgUiStreamAccess, type AgUiStreamState } from "@opencrane/state/conversation/ag-ui";

import { _ConversationEventHttpError, _ConversationEventProtocolError } from "./conversation-event-stream.errors.js";
import { ConversationEventStreamStatuses, type ConversationEventStream, type ConversationEventStreamUpdate, type StreamConversationEventsCommand } from "./conversation-event-stream.types.js";

/** Maximum incomplete SSE frame retained between network chunks. */
const _MAXIMUM_FRAME_BYTES = 1_048_576;

/** Reconnect-loop-owned progress published after every accepted frame. */
interface ConversationEventStreamProgress
{
	/** Latest strictly reduced state, including the exact accepted cursor. */
	state: AgUiStreamState;
	/** Latest heartbeat time accepted from the transport. */
	lastHeartbeatAt: number | null;
	/** Whether this response accepted any durable or overlay event. */
	receivedEvent: boolean;
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
			const progress: ConversationEventStreamProgress = { state, lastHeartbeatAt, receivedEvent: false };
			try
			{
				const body = await this._open(command, state);
				_Emit(command, { status: ConversationEventStreamStatuses.Live, state, reconnectAttempt, lastHeartbeatAt });
				await _ConsumeResponse(body, progress, command, reconnectAttempt);
				state = progress.state;
				lastHeartbeatAt = progress.lastHeartbeatAt;
				if (state.accessRevoked) throw new Error("conversation event access was revoked");
				if (progress.receivedEvent) reconnectAttempt = 0;
			}
			catch (error)
			{
				state = progress.state;
				lastHeartbeatAt = progress.lastHeartbeatAt;
				if (command.signal.aborted) break;
				if (error instanceof _ConversationEventHttpError && error.status === 404)
				{
					state = __RevokeAgUiStreamAccess();
					_Fail(command, state, reconnectAttempt, lastHeartbeatAt, error);
				}
				if (state.accessRevoked || error instanceof _ConversationEventProtocolError || (error instanceof _ConversationEventHttpError && !_IsRetryableHttpStatus(error.status))) _Fail(command, state, reconnectAttempt, lastHeartbeatAt, error);
				if (progress.receivedEvent) reconnectAttempt = 0;
				reconnectAttempt += 1;
				if (reconnectAttempt > (command.maximumReconnectAttempts ?? 3))
				{
					_Fail(command, state, reconnectAttempt, lastHeartbeatAt, error);
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
		const { data, error, response } = await this._api.client.GET("/me/conversations/{conversationId}/events", {
			params: {
				path: { conversationId: command.conversationId },
				...(cursor === undefined ? {} : { query: { cursor }, header: { "Last-Event-ID": cursor } })
			},
			parseAs: "stream",
			signal: command.signal
		});
		if (error !== undefined || !response.ok) throw new _ConversationEventHttpError(response.status);
		if (data === undefined || data === null) throw new _ConversationEventProtocolError("canonical conversation event response has no stream body");
		return data;
	}
}

/** Incrementally decode arbitrary byte chunks into complete strict SSE records. */
async function _ConsumeResponse(body: ReadableStream<Uint8Array>, progress: ConversationEventStreamProgress, command: StreamConversationEventsCommand, reconnectAttempt: number): Promise<void>
{
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try
	{
		while (!command.signal.aborted)
		{
			const chunk = await reader.read();
			if (chunk.done) break;
			buffer += decoder.decode(chunk.value, { stream: true });
			if (buffer.length > _MAXIMUM_FRAME_BYTES) throw new _ConversationEventProtocolError("canonical conversation event frame exceeded its bound");
			buffer = _ConsumeFrames(buffer, progress, command, reconnectAttempt);
		}
		buffer += decoder.decode();
		buffer = _ConsumeFrames(buffer, progress, command, reconnectAttempt);
		if (!command.signal.aborted && buffer.trim().length > 0) throw new _ConversationEventProtocolError("canonical conversation event stream ended with an incomplete frame");
	}
	finally
	{
		await reader.cancel().catch(function _IgnoreClosedReader(): void { /* The response may already be closed. */ });
		_releaseReader(reader);
	}
}

/** Release a response reader after cancellation without retaining buffered bytes. */
function _releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>): void { reader.releaseLock(); }

/** Consume every complete LF or CRLF-delimited SSE frame currently buffered. */
function _ConsumeFrames(buffer: string, progress: ConversationEventStreamProgress, command: StreamConversationEventsCommand, reconnectAttempt: number): string
{
	let remaining = buffer;
	while (true)
	{
		const boundary = /\r?\n\r?\n/u.exec(remaining);
		if (boundary === null || boundary.index === undefined) break;
		const frame = remaining.slice(0, boundary.index);
		remaining = remaining.slice(boundary.index + boundary[0].length);
		if (_IsHeartbeat(frame))
		{
			progress.lastHeartbeatAt = Date.now();
			_Emit(command, { status: ConversationEventStreamStatuses.Live, state: progress.state, reconnectAttempt, lastHeartbeatAt: progress.lastHeartbeatAt });
			continue;
		}
		const record = __DecodeAgUiSseRecord(frame);
		if (record === null) throw new _ConversationEventProtocolError("invalid canonical conversation event record");
		try
		{
			progress.state = __ReduceAgUiStream(progress.state, record);
		}
		catch (error)
		{
			throw new _ConversationEventProtocolError("canonical conversation event sequence is invalid", { cause: error });
		}
		progress.receivedEvent = true;
		_Emit(command, { status: ConversationEventStreamStatuses.Live, state: progress.state, reconnectAttempt, lastHeartbeatAt: progress.lastHeartbeatAt });
	}
	return remaining;
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

/** Fail one stream immediately while publishing the last accepted safe state. */
function _Fail(command: StreamConversationEventsCommand, state: AgUiStreamState, reconnectAttempt: number, lastHeartbeatAt: number | null, error: unknown): never
{
	const message = _ErrorMessage(error);
	_Emit(command, { status: ConversationEventStreamStatuses.Failed, state, reconnectAttempt, lastHeartbeatAt, error: message });
	throw new Error(message, { cause: error });
}

/** Admit only response statuses whose retry can plausibly recover without changing caller input. */
function _IsRetryableHttpStatus(status: number): boolean
{
	return status === 408 || status === 429 || status >= 500;
}
