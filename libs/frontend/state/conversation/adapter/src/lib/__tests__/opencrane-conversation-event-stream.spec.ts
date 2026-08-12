import { Injector, runInInjectionContext } from "@angular/core";
import { EventType } from "@ag-ui/core";
import { describe, expect, it, vi } from "vitest";

import { AG_UI_TOOL_FAILURE_EVENT, AG_UI_TOOL_RECOVERY_REQUIRED_EVENT, AgUiToolRecoveryProviderOutcomes } from "@opencrane/contracts";
import { ControlPlaneApiService } from "@opencrane/core";
import { AgUiRunStatuses, AgUiToolStatuses, __CreateAgUiStreamState, __DecodeAgUiSseRecord, __ReduceAgUiStream, type AgUiStreamState } from "@opencrane/state/conversation/ag-ui";

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

/** Return one successful generated-client stream response. */
function _Success(body: ReadableStream<Uint8Array>): { readonly data: ReadableStream<Uint8Array>; readonly response: Response }
{
	return { data: body, response: new Response(null, { status: 200 }) };
}

/** Return one generated-client HTTP failure while retaining its response status. */
function _HttpFailure(status: number): { readonly error: object; readonly response: Response }
{
	return { error: {}, response: new Response(null, { status }) };
}

/** Emit one accepted frame before the transport fails during the next read. */
function _FailAfter(frame: string): ReadableStream<Uint8Array>
{
	let emitted = false;
	return new ReadableStream<Uint8Array>({
		pull: function _Pull(controller): void
		{
			if (!emitted)
			{
				emitted = true;
				controller.enqueue(new TextEncoder().encode(frame));
				return;
			}
			controller.error(new Error("connection reset"));
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

/** Reduce one prior message fixture through the same strict AG-UI boundary as production. */
function _PriorState(): AgUiStreamState
{
	const start = __DecodeAgUiSseRecord(_Frame("prior-1", { type: EventType.TEXT_MESSAGE_START, messageId: "message-1", role: "user" }));
	const content = __DecodeAgUiSseRecord(_Frame("prior-2", { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "message-1", delta: "private" }));
	if (start === null || content === null) throw new Error("expected valid prior state fixtures");
	return __ReduceAgUiStream(__ReduceAgUiStream(__CreateAgUiStreamState(), start), content);
}

/** Exact display-safe recovery event used by reconnect and protocol-failure coverage. */
function _Recovery(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>>
{
	return {
		eventType: "tool.recovery_required",
		runId: "run-1",
		expectedAttempt: 2,
		toolCallId: "tool-1",
		occurredAt: "2026-08-11T08:30:00.000Z",
		recoveryCategory: "manual_action_required",
		preparationRetryCount: 3,
		preparationRetryLimit: 3,
		providerOutcome: AgUiToolRecoveryProviderOutcomes.UnknownAfterDispatch,
		...overrides,
	};
}

describe("OpenCraneConversationEventStream", function _Suite()
{
	it("reduces partial UTF-8 chunks incrementally and reports heartbeats", async function _StreamsIncrementally()
	{
		const controller = new AbortController();
		const updates: ConversationEventStreamUpdate[] = [];
		const body = _Frame("cursor-1", { type: EventType.RUN_STARTED, threadId: "conversation-1", runId: "run-1" }) + ": heartbeat\n\n" + _Frame("cursor-2", { type: EventType.TEXT_MESSAGE_START, messageId: "message-1", role: "assistant" }) + _Frame("cursor-3", { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "message-1", delta: "héllo" });
		const get = vi.fn().mockResolvedValue(_Success(_Stream(body.slice(0, 19), body.slice(19, 97), body.slice(97))));
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
		const get = vi.fn().mockResolvedValueOnce(_Success(_Stream(first))).mockResolvedValueOnce(_Success(_Stream(interrupt)));
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

	it("restores Needs recovery from the durable cursor and accepts later cancellation", async function _ReconnectsRecovery()
	{
		const controller = new AbortController();
		const recovery = _Frame("recovery-1", { type: EventType.RUN_STARTED, threadId: "conversation-1", runId: "run-1" })
			+ _Frame("recovery-2", { type: EventType.TOOL_CALL_START, toolCallId: "tool-1", toolCallName: "create_invoice" })
			+ _Frame("recovery-3", { type: EventType.CUSTOM, name: AG_UI_TOOL_FAILURE_EVENT, value: { eventType: "tool.failed", toolCallId: "tool-1", failureCode: "TimeoutError" } })
			+ _Frame("recovery-4", { type: EventType.CUSTOM, name: AG_UI_TOOL_RECOVERY_REQUIRED_EVENT, value: _Recovery() });
		const cancelled = _Frame("recovery-5", { type: EventType.RUN_ERROR, message: "Run cancelled: user_cancelled", code: "RUN_CANCELLED" });
		const get = vi.fn().mockResolvedValueOnce(_Success(_Stream(recovery))).mockResolvedValueOnce(_Success(_Stream(cancelled)));
		const stream = _EventStream(get);

		const state = await stream.stream({ conversationId: "conversation-1", signal: controller.signal, reconnectDelayMilliseconds: 0, onUpdate: function _Update(update): void
		{
			if (update.state.runStatus === AgUiRunStatuses.Cancelled) controller.abort();
		} });

		expect(get).toHaveBeenNthCalledWith(2, "/me/conversations/{conversationId}/events", {
			params: { path: { conversationId: "conversation-1" }, query: { cursor: "recovery-4" }, header: { "Last-Event-ID": "recovery-4" } },
			parseAs: "stream",
			signal: controller.signal
		});
		expect(state.cursor).toBe("recovery-5");
		expect(state.runStatus).toBe(AgUiRunStatuses.Cancelled);
		expect(state.runRecovery).toEqual(_Recovery());
		expect(state.tools["tool-1"]).toMatchObject({ status: AgUiToolStatuses.NeedsRecovery, failures: [{ code: "TimeoutError" }], recovery: _Recovery() });
	});

	it("fails closed when a recovery envelope carries secret-bearing extension fields", async function _RejectsUnsafeRecovery()
	{
		const controller = new AbortController();
		const content = _Frame("unsafe-1", { type: EventType.RUN_STARTED, threadId: "conversation-1", runId: "run-1" })
			+ _Frame("unsafe-2", { type: EventType.TOOL_CALL_START, toolCallId: "tool-1", toolCallName: "create_invoice" })
			+ _Frame("unsafe-3", { type: EventType.CUSTOM, name: AG_UI_TOOL_RECOVERY_REQUIRED_EVENT, value: _Recovery({ authorization: "Bearer secret" }) });
		const get = vi.fn().mockResolvedValue(_Success(_Stream(content)));
		const stream = _EventStream(get);

		await expect(stream.stream({ conversationId: "conversation-1", signal: controller.signal, reconnectDelayMilliseconds: 0 })).rejects.toThrow("canonical conversation event sequence is invalid");
		expect(get).toHaveBeenCalledTimes(1);
	});

	it("fails malformed protocol frames immediately without using the default retries", async function _RejectsMalformed()
	{
		const controller = new AbortController();
		const statuses: ConversationEventStreamStatuses[] = [];
		const get = vi.fn().mockResolvedValue(_Success(_Stream("event: ag-ui\ndata: {bad}\n\n")));
		const stream = _EventStream(get);

		await expect(stream.stream({ conversationId: "conversation-1", signal: controller.signal, reconnectDelayMilliseconds: 0, onUpdate: function _Update(update): void { statuses.push(update.status); } })).rejects.toThrow("invalid canonical conversation event record");
		expect(get).toHaveBeenCalledTimes(1);
		expect(statuses.at(-1)).toBe(ConversationEventStreamStatuses.Failed);
	});

	it("reconnects from progress accepted before a mid-response transport failure", async function _KeepsMidResponseProgress()
	{
		const controller = new AbortController();
		const first = _Frame("cursor-before-reset", { type: EventType.RUN_STARTED, threadId: "conversation-1", runId: "run-1" });
		const second = _Frame("cursor-after-reset", { type: EventType.TEXT_MESSAGE_START, messageId: "message-1", role: "assistant" });
		const get = vi.fn().mockResolvedValueOnce(_Success(_FailAfter(first))).mockResolvedValueOnce(_Success(_Stream(second)));
		const stream = _EventStream(get);

		const state = await stream.stream({ conversationId: "conversation-1", signal: controller.signal, reconnectDelayMilliseconds: 0, onUpdate: function _Update(update): void
		{
			if (update.state.cursor === "cursor-after-reset") controller.abort();
		} });

		expect(get).toHaveBeenNthCalledWith(2, "/me/conversations/{conversationId}/events", {
			params: { path: { conversationId: "conversation-1" }, query: { cursor: "cursor-before-reset" }, header: { "Last-Event-ID": "cursor-before-reset" } },
			parseAs: "stream",
			signal: controller.signal
		});
		expect(state.cursor).toBe("cursor-after-reset");
		expect(state.runId).toBe("run-1");
	});

	it("retains a heartbeat observed before a transport reconnect", async function _KeepsHeartbeatProgress()
	{
		const controller = new AbortController();
		const updates: ConversationEventStreamUpdate[] = [];
		const event = _Frame("cursor-1", { type: EventType.RUN_STARTED, threadId: "conversation-1", runId: "run-1" });
		const get = vi.fn().mockResolvedValueOnce(_Success(_FailAfter(": heartbeat\n\n"))).mockResolvedValueOnce(_Success(_Stream(event)));
		const stream = _EventStream(get);

		await stream.stream({ conversationId: "conversation-1", signal: controller.signal, reconnectDelayMilliseconds: 0, onUpdate: function _Update(update): void
		{
			updates.push(update);
			if (update.state.cursor === "cursor-1") controller.abort();
		} });

		expect(updates.some(update => update.status === ConversationEventStreamStatuses.Reconnecting && update.lastHeartbeatAt !== null)).toBe(true);
	});

	it("resets consecutive failures when a later response accepts progress before failing", async function _ResetsFailuresAfterProgress()
	{
		const controller = new AbortController();
		const accepted = _Frame("accepted-cursor", { type: EventType.RUN_STARTED, threadId: "conversation-1", runId: "run-1" });
		const resumed = _Frame("resumed-cursor", { type: EventType.TEXT_MESSAGE_START, messageId: "message-1", role: "assistant" });
		const get = vi.fn().mockRejectedValueOnce(new Error("connection refused")).mockResolvedValueOnce(_Success(_FailAfter(accepted))).mockResolvedValueOnce(_Success(_Stream(resumed)));
		const stream = _EventStream(get);

		const state = await stream.stream({ conversationId: "conversation-1", signal: controller.signal, maximumReconnectAttempts: 1, reconnectDelayMilliseconds: 0, onUpdate: function _Update(update): void
		{
			if (update.state.cursor === "resumed-cursor") controller.abort();
		} });

		expect(get).toHaveBeenCalledTimes(3);
		expect(get).toHaveBeenNthCalledWith(3, "/me/conversations/{conversationId}/events", {
			params: { path: { conversationId: "conversation-1" }, query: { cursor: "accepted-cursor" }, header: { "Last-Event-ID": "accepted-cursor" } },
			parseAs: "stream",
			signal: controller.signal
		});
		expect(state.cursor).toBe("resumed-cursor");
		expect(state.runId).toBe("run-1");
	});

	it("purges state and terminates when the live stream reports authority loss", async function _PurgesRevoked()
	{
		const controller = new AbortController();
		const content = _Frame("cursor-1", { type: EventType.TEXT_MESSAGE_START, messageId: "message-1", role: "user" }) + _Frame("cursor-2", { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "message-1", delta: "private" }) + _Frame(undefined, { type: EventType.CUSTOM, name: "opencrane.access_revoked", value: { eventType: "access.revoked" } });
		const get = vi.fn().mockResolvedValue(_Success(_Stream(content)));
		const stream = _EventStream(get);

		await expect(stream.stream({ conversationId: "conversation-1", signal: controller.signal, maximumReconnectAttempts: 0 })).rejects.toThrow("access was revoked");
	});

	it("classifies endpoint 404 as authority loss and purges prior content", async function _PurgesNotFound()
	{
		const controller = new AbortController();
		const updates: ConversationEventStreamUpdate[] = [];
		const get = vi.fn().mockResolvedValue(_HttpFailure(404));
		const stream = _EventStream(get);

		await expect(stream.stream({ conversationId: "conversation-1", signal: controller.signal, initialState: _PriorState(), onUpdate: function _Update(update): void { updates.push(update); } })).rejects.toThrow("access was revoked");

		const failed = updates.at(-1);
		expect(get).toHaveBeenCalledTimes(1);
		expect(failed?.status).toBe(ConversationEventStreamStatuses.Failed);
		expect(failed?.state.accessRevoked).toBe(true);
		expect(failed?.state.cursor).toBeNull();
		expect(failed?.state.messages).toEqual({});
	});
});
