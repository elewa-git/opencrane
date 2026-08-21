import { EventType } from "@ag-ui/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgUiRunStatuses } from "@opencrane/state/conversation/ag-ui";
import { ConversationEventStreamMessageError, ConversationEventStreamStatuses } from "@opencrane/state/conversation/stream";

import { OpenCraneConversationEventStream } from "../opencrane-conversation-event-stream";

/** Minimal browser socket whose server-side peer is driven directly by each test. */
class _Socket extends EventTarget
{
	/** Browser state used by the adapter before it can submit a command. */
	public static readonly OPEN = 1;
	/** Every connection created by the adapter in test order. */
	public static readonly connections: _Socket[] = [];
	/** Address selected by the browser. */
	public readonly url: string;
	/** Browser-visible connection lifecycle state. */
	public readyState = 0;
	/** Serialized commands the browser sent to the server. */
	public readonly sent: string[] = [];

	/** Construct and asynchronously open a controlled same-origin socket. */
	public constructor(url: string)
	{
		super();
		this.url = url;
		_Socket.connections.push(this);
		queueMicrotask(() => { this.readyState = _Socket.OPEN; this.dispatchEvent(new Event("open")); });
	}

	/** Record a browser command for the test's server peer. */
	public send(value: string): void { this.sent.push(value); }
	/** Close from either browser or server and expose the WebSocket close code. */
	public close(code = 1000): void
	{
		if (this.readyState === 3) return;
		this.readyState = 3;
		const event = new Event("close");
		Object.defineProperty(event, "code", { value: code });
		this.dispatchEvent(event);
	}
	/** Deliver one text frame from the server. */
	public deliver(value: string): void
	{
		const event = new Event("message");
		Object.defineProperty(event, "data", { value });
		this.dispatchEvent(event);
	}
}

/** Encode one structured projection frame carried by the conversation WebSocket. */
function _Frame(id: string | undefined, data: object): string { return JSON.stringify({ type: "conversation.event", ...(id === undefined ? {} : { id }), event: "ag-ui", data }); }

afterEach(function _RestoreSocket()
{
	_Socket.connections.length = 0;
	vi.unstubAllGlobals();
});

describe("OpenCraneConversationEventStream", function _Suite()
{
	it("receives the message history and live tail through a WebSocket", async function _StreamsSocket()
	{
		vi.stubGlobal("location", { origin: "https://testv4.dev.opencrane.ai" });
		vi.stubGlobal("WebSocket", _Socket);
		const controller = new AbortController();
		const stream = new OpenCraneConversationEventStream();
		const result = stream.stream({ conversationId: "conversation-1", signal: controller.signal, onUpdate(update)
		{
			if (update.state.cursor === "cursor-2") controller.abort();
		} });
		await vi.waitFor(() => expect(_Socket.connections).toHaveLength(1));
		const socket = _Socket.connections[0]!;
		socket.deliver(_Frame("cursor-1", { type: EventType.TEXT_MESSAGE_START, messageId: "message-1", role: "assistant" }));
		socket.deliver(JSON.stringify({ type: "conversation.heartbeat" }));
		socket.deliver(_Frame("cursor-2", { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "message-1", delta: "hello" }));

		const state = await result;
		expect(socket.url).toBe("wss://testv4.dev.opencrane.ai/api/v1/me/conversations/conversation-1/socket");
		expect(state.messages["message-1"]?.text).toBe("hello");
		expect(socket.sent).toEqual([]);
	});

	it("reconnects with the opaque cursor after a socket closes", async function _Reconnects()
	{
		vi.stubGlobal("location", { origin: "https://testv4.dev.opencrane.ai" });
		vi.stubGlobal("WebSocket", _Socket);
		const controller = new AbortController();
		const stream = new OpenCraneConversationEventStream();
		const result = stream.stream({ conversationId: "conversation-1", signal: controller.signal, reconnectDelayMilliseconds: 0, onUpdate(update)
		{
			if (update.state.runStatus === AgUiRunStatuses.Interrupted) controller.abort();
		} });
		await vi.waitFor(() => expect(_Socket.connections).toHaveLength(1));
		_Socket.connections[0]!.deliver(_Frame("opaque/+= cursor", { type: EventType.RUN_STARTED, threadId: "conversation-1", runId: "run-1" }));
		_Socket.connections[0]!.close();
		await vi.waitFor(() => expect(_Socket.connections).toHaveLength(2));
		_Socket.connections[1]!.deliver(_Frame(undefined, { type: EventType.RUN_FINISHED, threadId: "conversation-1", runId: "run-1", outcome: { type: "interrupt", interrupts: [{ id: "approval-1", reason: "tool_approval" }] } }));

		const state = await result;
		expect(_Socket.connections[1]!.url).toContain("cursor=opaque%2F%2B%3D+cursor");
		expect(state.interrupts[0]?.id).toBe("approval-1");
	});

	it("submits a participant message and waits for its socket acknowledgement", async function _SubmitsMessage()
	{
		vi.stubGlobal("location", { origin: "https://testv4.dev.opencrane.ai" });
		vi.stubGlobal("WebSocket", _Socket);
		const controller = new AbortController();
		const stream = new OpenCraneConversationEventStream();
		const tail = stream.stream({ conversationId: "conversation-1", signal: controller.signal });
		await vi.waitFor(() => expect(_Socket.connections[0]?.readyState).toBe(_Socket.OPEN));
		const submitted = stream.submit({ conversationId: "conversation-1", idempotencyKey: "retry-1", blocks: [{ id: "block-1", kind: "text", value: "hello" }] });
		const command = JSON.parse(_Socket.connections[0]!.sent[0] ?? "{}") as { readonly requestId: string; readonly type: string };
		expect(command.type).toBe("conversation.message.submit");
		_Socket.connections[0]!.deliver(JSON.stringify({ type: "conversation.message.accepted", requestId: command.requestId, outcome: "accepted" }));
		await expect(submitted).resolves.toBeUndefined();
		controller.abort();
		await tail;
	});

	it("preserves a permanent socket denial for the workspace gateway", async function _PreservesDenial()
	{
		vi.stubGlobal("location", { origin: "https://testv4.dev.opencrane.ai" });
		vi.stubGlobal("WebSocket", _Socket);
		const controller = new AbortController();
		const stream = new OpenCraneConversationEventStream();
		const tail = stream.stream({ conversationId: "conversation-1", signal: controller.signal });
		await vi.waitFor(() => expect(_Socket.connections[0]?.readyState).toBe(_Socket.OPEN));
		const submitted = stream.submit({ conversationId: "conversation-1", idempotencyKey: "retry-1", blocks: [{ id: "block-1", kind: "text", value: "hello" }] });
		const command = JSON.parse(_Socket.connections[0]!.sent[0] ?? "{}") as { readonly requestId: string };
		_Socket.connections[0]!.deliver(JSON.stringify({ type: "conversation.message.rejected", requestId: command.requestId, error: "conversation_closed" }));
		await expect(submitted).rejects.toMatchObject({ closed: true, accessChanged: false });
		controller.abort();
		await tail;
	});

	it("purges projected state when the socket closes for lost access", async function _PurgesAccess()
	{
		vi.stubGlobal("location", { origin: "https://testv4.dev.opencrane.ai" });
		vi.stubGlobal("WebSocket", _Socket);
		const updates: ConversationEventStreamStatuses[] = [];
		const stream = new OpenCraneConversationEventStream();
		const result = stream.stream({ conversationId: "conversation-1", signal: new AbortController().signal, maximumReconnectAttempts: 0, onUpdate(update) { updates.push(update.status); } });
		await vi.waitFor(() => expect(_Socket.connections).toHaveLength(1));
		_Socket.connections[0]!.close(1008);
		await expect(result).rejects.toThrow("access was revoked");
		expect(updates.at(-1)).toBe(ConversationEventStreamStatuses.Failed);
	});

	it("rejects a message when no selected-conversation socket is live", async function _RejectsDisconnectedSubmit()
	{
		const stream = new OpenCraneConversationEventStream();
		await expect(stream.submit({ conversationId: "conversation-1", idempotencyKey: "retry-1", blocks: [{ id: "block-1", kind: "text", value: "hello" }] })).rejects.toBeInstanceOf(ConversationEventStreamMessageError);
	});
});
