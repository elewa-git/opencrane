import { Injector, runInInjectionContext } from "@angular/core";
import { EventType } from "@ag-ui/core";
import { describe, expect, it, vi } from "vitest";

import { ControlPlaneApiService } from "@opencrane/core";
import { AgUiRunStatuses } from "@opencrane/state/conversation/ag-ui";

import { ConversationEventStreamStatuses, type ConversationEventStreamUpdate } from "../conversation-event-stream.types.js";
import { OpenCraneConversationEventStream } from "../opencrane-conversation-event-stream.js";

/** Encode text chunks as one incrementally consumable byte stream. */
function _Stream(...chunks: readonly string[]): ReadableStream<Uint8Array>
{
	return new ReadableStream<Uint8Array>({
		start: function _Start(controller): void
		{
			for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
			controller.close();
		},
	});
}

/** Construct one event stream with a controlled generated client. */
function _EventStream(get: ReturnType<typeof vi.fn>): OpenCraneConversationEventStream
{
	const injector = Injector.create({ providers: [{ provide: ControlPlaneApiService, useValue: { client: { GET: get } } }] });
	return runInInjectionContext(injector, function _Create(): OpenCraneConversationEventStream { return new OpenCraneConversationEventStream(); });
}

/** Encode one durable or cursorless AG-UI SSE frame. */
function _Frame(id: string | undefined, data: object): string
{
	return `${id === undefined ? "" : `id: ${id}\n`}event: ag-ui\ndata: ${JSON.stringify(data)}\n\n`;
}

describe("OpenCraneConversationEventStream", function _Suite()
{
	it("reduces partial UTF-8 chunks incrementally and reports heartbeats", async function _StreamsIncrementally()
	{
		const controller = new AbortController();
		const updates: ConversationEventStreamUpdate[] = [];
		const body = _Frame("cursor-1", { type: EventType.RUN_STARTED, threadId: "conversation-1", runId: "run-1" }) + ": heartbeat\n\n" + _Frame("cursor-2", { type: EventType.TEXT_MESSAGE_START, messageId: "message-1", role: "assistant" }) + _Frame("cursor-3", { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "message-1", delta: "héllo" });
		const get = vi.fn().mockResolvedValue({ data: _Stream(body.slice(0, 19), body.slice(19, 97), body.slice(97)) });
		const stream = _EventStream(get);

		const state = await stream.stream({ conversationId: "conversation-1", signal: controller.signal, reconnectDelayMilliseconds: 0, onUpdate: function _Update(update): void
		{
			updates.push(update);
			if (update.state.cursor === "cursor-3") controller.abort();
		} });

		expect(get).toHaveBeenCalledWith("/me/conversations/{conversationId}/events", { params: { path: { conversationId: "conversation-1" } }, parseAs: "stream", signal: controller.signal });
		expect(state.messages["message-1"]?.text).toBe("héllo");
		expect(updates.some(update => update.lastHeartbeatAt !== null)).toBe(true);
		expect(updates.at(-1)?.status).toBe(ConversationEventStreamStatuses.Aborted);
	});

	it("reconnects with the exact opaque cursor and restores a cursorless interrupt", async function _Reconnects()
	{
		const controller = new AbortController();
		const first = _Frame("opaque/+= cursor", { type: EventType.RUN_STARTED, threadId: "conversation-1", runId: "run-1" });
		const interrupt = _Frame(undefined, { type: EventType.RUN_FINISHED, threadId: "conversation-1", runId: "run-1", outcome: { type: "interrupt", interrupts: [{ id: "approval-1", reason: "tool_approval" }] } });
		const get = vi.fn().mockResolvedValueOnce({ data: _Stream(first) }).mockResolvedValueOnce({ data: _Stream(interrupt) });
		const stream = _EventStream(get);

		const state = await stream.stream({ conversationId: "conversation-1", signal: controller.signal, reconnectDelayMilliseconds: 0, onUpdate: function _Update(update): void
		{
			if (update.state.interrupts.length > 0) controller.abort();
		} });

		expect(get).toHaveBeenNthCalledWith(2, "/me/conversations/{conversationId}/events", {
			params: { path: { conversationId: "conversation-1" }, query: { cursor: "opaque/+= cursor" }, header: { "Last-Event-ID": "opaque/+= cursor" } },
			parseAs: "stream",
			signal: controller.signal
		});
		expect(state.cursor).toBe("opaque/+= cursor");
		expect(state.runStatus).toBe(AgUiRunStatuses.Interrupted);
		expect(state.interrupts[0]?.id).toBe("approval-1");
	});

	it("fails closed on malformed frames after the configured retry bound", async function _RejectsMalformed()
	{
		const controller = new AbortController();
		const statuses: ConversationEventStreamStatuses[] = [];
		const get = vi.fn().mockResolvedValue({ data: _Stream("event: ag-ui\ndata: {bad}\n\n") });
		const stream = _EventStream(get);

		await expect(stream.stream({ conversationId: "conversation-1", signal: controller.signal, maximumReconnectAttempts: 0, onUpdate: function _Update(update): void { statuses.push(update.status); } })).rejects.toThrow("invalid canonical conversation event record");
		expect(statuses.at(-1)).toBe(ConversationEventStreamStatuses.Failed);
	});

	it("purges state and terminates when the live stream reports authority loss", async function _PurgesRevoked()
	{
		const controller = new AbortController();
		const content = _Frame("cursor-1", { type: EventType.TEXT_MESSAGE_START, messageId: "message-1", role: "user" }) + _Frame("cursor-2", { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "message-1", delta: "private" }) + _Frame(undefined, { type: EventType.CUSTOM, name: "opencrane.access_revoked", value: { eventType: "access.revoked" } });
		const get = vi.fn().mockResolvedValue({ data: _Stream(content) });
		const stream = _EventStream(get);

		await expect(stream.stream({ conversationId: "conversation-1", signal: controller.signal, maximumReconnectAttempts: 0 })).rejects.toThrow("access was revoked");
	});
});
