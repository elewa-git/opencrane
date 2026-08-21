import { Injectable } from "@angular/core";

import { __AgUiResumeCursor, __CreateAgUiStreamState, __DecodeAgUiSocketRecord, __ReduceAgUiStream, __RevokeAgUiStreamAccess, type AgUiStreamState } from "@opencrane/state/conversation/ag-ui";
import { ConversationEventStreamMessageError, ConversationEventStreamStatuses, type ConversationEventStream, type ConversationEventStreamUpdate, type StreamConversationEventsCommand, type SubmitConversationEventStreamMessageCommand } from "@opencrane/state/conversation/stream";

/** Maximum time the browser waits for the socket authority to acknowledge a submitted message. */
const _MESSAGE_ACKNOWLEDGEMENT_TIMEOUT_MILLISECONDS = 30_000;

/** A request waiting for its matching socket acknowledgement. */
interface PendingMessage
{
	/** Exact socket whose acknowledgement alone may settle this command. */
	readonly socket: WebSocket;
	/** Resolves only after the server confirms admission or an idempotent replay. */
	readonly resolve: () => void;
	/** Rejects when the server refuses, disconnects, or does not answer in time. */
	readonly reject: (error: Error) => void;
	/** Cancels the acknowledgement deadline once the request has settled. */
	readonly timeout: ReturnType<typeof setTimeout>;
}

/** Mutable progress carried through one socket connection and its reconnect handoff. */
interface ConversationSocketProgress
{
	/** Last projection state accepted from the authenticated socket. */
	state: AgUiStreamState;
	/** Most recent heartbeat received from the socket, or null before the first one. */
	lastHeartbeatAt: number | null;
	/** Whether this connection delivered a projection event before it closed. */
	receivedEvent: boolean;
}

/**
 * Reads conversation projections and submits messages over the authenticated browser WebSocket.
 *
 * The socket carries the historical replay, live AG-UI events, and participant commands. The
 * browser sends the normal same-origin session cookie during its upgrade; it never supplies a
 * subject, silo, or access token. A reconnect puts the opaque projection cursor in the socket URL,
 * so the authority resumes after the last accepted event instead of loading messages through HTTP.
 *
 * The workspace composition provides one instance for the selected conversation. `stream` returns
 * the last accepted projection when its signal aborts and rejects after its reconnect allowance is
 * exhausted; `submit` resolves only after the socket acknowledges the idempotency key.
 *
 * Called by: `ConversationWorkspaceStore` through `CONVERSATION_WORKSPACE_EVENT_STREAM`; the
 * workspace gateway uses {@link submit} for ordinary participant messages.
 */
@Injectable()
export class OpenCraneConversationEventStream implements ConversationEventStream
{
	/** Socket currently owned by the selected conversation. */
	private _socket: WebSocket | null = null;
	/** Conversation that owns `_socket`, preventing a late command from reaching a new selection. */
	private _conversationId: string | null = null;
	/** In-flight message commands keyed by their browser-generated acknowledgement coordinate. */
	private readonly _pendingMessages = new Map<string, PendingMessage>();

	/** Stream this conversation's history and live projection until the caller aborts it. */
	public async stream(command: StreamConversationEventsCommand): Promise<AgUiStreamState>
	{
		_ValidateCommand(command);
		let state = command.initialState ?? __CreateAgUiStreamState();
		let reconnectAttempt = 0;
		let lastHeartbeatAt: number | null = null;
		_Emit(command, { status: ConversationEventStreamStatuses.Connecting, state, reconnectAttempt, lastHeartbeatAt });

		while (!command.signal.aborted)
		{
			const progress: ConversationSocketProgress = { state, lastHeartbeatAt, receivedEvent: false };
			try
			{
				await this._connect(command, progress, reconnectAttempt);
				state = progress.state;
				lastHeartbeatAt = progress.lastHeartbeatAt;
				if (state.accessRevoked) throw new Error("conversation socket access was revoked");
				if (progress.receivedEvent) reconnectAttempt = 0;
			}
			catch (error)
			{
				state = progress.state;
				lastHeartbeatAt = progress.lastHeartbeatAt;
				if (command.signal.aborted) break;
				if (state.accessRevoked) _Fail(command, __RevokeAgUiStreamAccess(), reconnectAttempt, lastHeartbeatAt, error);
				if (progress.receivedEvent) reconnectAttempt = 0;
				reconnectAttempt += 1;
				if (reconnectAttempt > (command.maximumReconnectAttempts ?? 3)) _Fail(command, state, reconnectAttempt, lastHeartbeatAt, error);
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

	/** Submit a message through the currently live socket and wait for its matching acknowledgement. */
	public submit(command: SubmitConversationEventStreamMessageCommand): Promise<void>
	{
		const socket = this._socket;
		if (socket === null || this._conversationId !== command.conversationId || socket.readyState !== WebSocket.OPEN) return Promise.reject(new ConversationEventStreamMessageError());
		const requestId = globalThis.crypto.randomUUID();
		return new Promise<void>((resolve, reject) =>
		{
			const timeout = setTimeout(() => this._rejectMessage(requestId), _MESSAGE_ACKNOWLEDGEMENT_TIMEOUT_MILLISECONDS);
			this._pendingMessages.set(requestId, { socket, resolve, reject, timeout });
			try { socket.send(JSON.stringify({ type: "conversation.message.submit", requestId, idempotencyKey: command.idempotencyKey, blocks: command.blocks })); }
			catch { this._rejectMessage(requestId); }
		});
	}

	/** Open one socket and resolve when it closes, leaving reconnection to `stream`. */
	private _connect(command: StreamConversationEventsCommand, progress: ConversationSocketProgress, reconnectAttempt: number): Promise<void>
	{
		const cursor = __AgUiResumeCursor(progress.state);
		const socket = new WebSocket(_SocketUrl(command.conversationId, cursor));
		this._release(this._socket, new ConversationEventStreamMessageError());
		this._socket = socket;
		this._conversationId = command.conversationId;
		return new Promise<void>((resolve, reject) =>
		{
			let opened = false;
			function _Finish(): void { command.signal.removeEventListener("abort", _Abort); }
			function _Abort(): void { socket.close(1000, "selection_changed"); }
			command.signal.addEventListener("abort", _Abort, { once: true });
			socket.addEventListener("open", () =>
			{
				opened = true;
				_Emit(command, { status: ConversationEventStreamStatuses.Live, state: progress.state, reconnectAttempt, lastHeartbeatAt: progress.lastHeartbeatAt });
			});
			socket.addEventListener("message", event =>
			{
				if (typeof event.data !== "string") { socket.close(1003, "text_frames_required"); return; }
				if (_HandleMessageAcknowledgement(event.data, this._pendingMessages)) return;
				try
				{
					const frame = _Json(event.data);
					if (_IsHeartbeat(frame)) { progress.lastHeartbeatAt = Date.now(); _Emit(command, { status: ConversationEventStreamStatuses.Live, state: progress.state, reconnectAttempt, lastHeartbeatAt: progress.lastHeartbeatAt }); return; }
					const record = __DecodeAgUiSocketRecord(frame);
					if (record === null) throw new Error("invalid conversation socket event");
					progress.state = __ReduceAgUiStream(progress.state, record);
					progress.receivedEvent = true;
					_Emit(command, { status: ConversationEventStreamStatuses.Live, state: progress.state, reconnectAttempt, lastHeartbeatAt: progress.lastHeartbeatAt });
				}
				catch (error) { socket.close(1002, "invalid_event"); reject(error); }
			});
			socket.addEventListener("close", event =>
			{
				_Finish();
				this._release(socket, new ConversationEventStreamMessageError());
				if (command.signal.aborted) { resolve(); return; }
				if (event.code === 1008) { progress.state = __RevokeAgUiStreamAccess(); reject(new Error("conversation socket access was revoked")); return; }
				if (!opened) { reject(new Error("conversation socket could not connect")); return; }
				resolve();
			});
			socket.addEventListener("error", () => { if (!opened) reject(new Error("conversation socket could not connect")); });
		});
	}

	/** Reject every command owned by a socket that just closed or was replaced. */
	private _release(socket: WebSocket | null, error: Error): void
	{
		if (socket === null) return;
		for (const [requestId, pending] of this._pendingMessages)
		{
			if (pending.socket !== socket) continue;
			clearTimeout(pending.timeout);
			pending.reject(error);
			this._pendingMessages.delete(requestId);
		}
		if (this._socket === socket) { this._socket = null; this._conversationId = null; }
	}

	/** Reject one unacknowledged command after a socket failure or acknowledgement timeout. */
	private _rejectMessage(requestId: string): void
	{
		const pending = this._pendingMessages.get(requestId);
		if (pending === undefined) return;
		clearTimeout(pending.timeout);
		this._pendingMessages.delete(requestId);
		pending.reject(new ConversationEventStreamMessageError());
	}
}

/** Build the same-origin socket address so the browser supplies its existing session cookie. */
function _SocketUrl(conversationId: string, cursor: string | undefined): string
{
	const origin = globalThis.location.origin.replace(/^http/u, "ws");
	const url = new URL(`/api/v1/me/conversations/${encodeURIComponent(conversationId)}/socket`, origin);
	if (cursor !== undefined) url.searchParams.set("cursor", cursor);
	return url.toString();
}

/** Resolve a matching command acknowledgement and keep projection frames on their separate path. */
function _HandleMessageAcknowledgement(raw: string, pendingMessages: ReadonlyMap<string, PendingMessage>): boolean
{
	let message: unknown;
	try { message = JSON.parse(raw) as unknown; }
	catch { return false; }
	if (typeof message !== "object" || message === null) return false;
	const value = message as Record<string, unknown>;
	const requestId = value["requestId"];
	if (typeof requestId !== "string") return false;
	const pending = pendingMessages.get(requestId);
	if (pending === undefined) return true;
	clearTimeout(pending.timeout);
	(pendingMessages as Map<string, PendingMessage>).delete(requestId);
	if (value["type"] === "conversation.message.accepted") pending.resolve();
	else pending.reject(new ConversationEventStreamMessageError(typeof value["error"] === "string" ? value["error"] : undefined));
	return true;
}

/** Recognize the server's transport heartbeat without feeding it to the AG-UI decoder. */
function _IsHeartbeat(value: unknown): boolean { return typeof value === "object" && value !== null && (value as Record<string, unknown>)["type"] === "conversation.heartbeat"; }

/** Parse one text WebSocket frame without allowing a malformed payload to escape the transport. */
function _Json(value: string): unknown { try { return JSON.parse(value) as unknown; } catch { return null; } }

/** Emit one state change when the caller opted into stream progress. */
function _Emit(command: StreamConversationEventsCommand, update: ConversationEventStreamUpdate): void { command.onUpdate?.(update); }

/** Wait before reconnecting, but return immediately if the screen selection changed. */
async function _Wait(milliseconds: number, signal: AbortSignal): Promise<void>
{
	if (signal.aborted || milliseconds === 0) return;
	await new Promise<void>(function _Until(resolve)
	{
		const timeout = setTimeout(resolve, milliseconds);
		signal.addEventListener("abort", function _Abort() { clearTimeout(timeout); resolve(); }, { once: true });
	});
}

/** Reject invalid socket stream options before opening a network connection. */
function _ValidateCommand(command: StreamConversationEventsCommand): void
{
	if (command.conversationId.trim().length === 0) throw new Error("conversation id is required");
	if (command.maximumReconnectAttempts !== undefined && (!Number.isSafeInteger(command.maximumReconnectAttempts) || command.maximumReconnectAttempts < 0 || command.maximumReconnectAttempts > 10)) throw new Error("maximum reconnect attempts must be between zero and ten");
	if (command.reconnectDelayMilliseconds !== undefined && (!Number.isSafeInteger(command.reconnectDelayMilliseconds) || command.reconnectDelayMilliseconds < 0 || command.reconnectDelayMilliseconds > 30_000)) throw new Error("reconnect delay must be between zero and thirty seconds");
}

/** Stop the stream with the last accepted state and browser-safe fixed copy. */
function _Fail(command: StreamConversationEventsCommand, state: AgUiStreamState, reconnectAttempt: number, lastHeartbeatAt: number | null, error: unknown): never
{
	const message = error instanceof Error ? error.message : "conversation socket failed";
	_Emit(command, { status: ConversationEventStreamStatuses.Failed, state, reconnectAttempt, lastHeartbeatAt, error: message });
	throw new Error(message, { cause: error });
}
