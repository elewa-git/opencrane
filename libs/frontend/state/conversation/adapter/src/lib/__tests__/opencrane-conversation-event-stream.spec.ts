import { Injector, runInInjectionContext } from "@angular/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationComputerStates, type ConversationComputer } from "@opencrane/contracts";
import { ControlPlaneApiService } from "@opencrane/core";
import { ConversationEventStreamStatuses, type ConversationEventStreamUpdate } from "@opencrane/state/conversation/stream";

import { OpenCraneConversationEventStream } from "../opencrane-conversation-event-stream";

/** Builds a participant-visible message at the chosen stream position. */
function _Entry(position = "1", conversationId = "conversation-1")
{
	return { schemaVersion: 1 as const, id: "57de859d-1fb6-4782-aa0b-2b3d4dfd2292", conversationId, position, author: { kind: "human" as const, principalId: "principal-1", participantId: "participant-1", issuer: "https://issuer.example", authenticatedAt: "2026-09-05T00:00:00.000Z", name: "Jente", avatarArtifactRevisionId: null }, provenance: "human-authored" as const, visibility: { audience: "conversation" as const }, runId: null, causationId: "command-1", correlationId: "request-1", idempotencyKey: "57de859d-1fb6-4782-aa0b-2b3d4dfd2292", occurredAt: "2026-09-05T00:00:00.000Z", attestation: null, kind: "message" as const, state: "completed" as const, blocks: [{ id: "block-1", kind: "text" as const, payloadRef: "payload-1", ciphertextDigest: "sha256:digest" }], replyToEntryId: null, addressedAgentIdentityId: null, activation: "none" as const };
}

/** Supplies every field in the existing logical computer projection. */
function _Computer(state = ConversationComputerStates.Cold): ConversationComputer
{
	return { schemaVersion: 1, id: "computer-1", siloId: "silo-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", state, leaseGeneration: 0, workspaceCheckpoint: null, createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z" };
}

/** Supplies a generated-client history result. */
function _History(computer: ConversationComputer | null = null)
{
	return { data: { entries: [_Entry()], payloads: { "payload-1": "Hello" }, nextPosition: "1", computer }, response: new Response(null, { status: 200 }) };
}

/** Encodes the server's history frame without changing its checkpoint. */
function _Frame(position = "2", entries = [_Entry(position)], payloads: Record<string, string> = {})
{
	return `event: history\nid: ${position}\ndata: ${JSON.stringify({ entries, payloads, nextPosition: position, computer: null })}\n\n`;
}

/** Supplies an SSE result with caller-controlled closure or disconnect behavior. */
function _Events(text = "", close = false, fail = false)
{
	const cancel = vi.fn();
	const body = new ReadableStream<Uint8Array>({
		start(controller)
		{
			if (text)
				controller.enqueue(new TextEncoder().encode(text));
			if (close)
				controller.close();
			if (fail)
				controller.error(new Error("private upstream details"));
		},
		cancel
	});
	return { data: body, response: new Response(null, { headers: { "Content-Type": "text/event-stream; charset=utf-8" } }), cancel };
}

/** Constructs the adapter with its existing generated-client boundary. */
function _Stream(get: ReturnType<typeof vi.fn>): OpenCraneConversationEventStream
{
	const injector = Injector.create({ providers: [{ provide: ControlPlaneApiService, useValue: { client: { GET: get } } }] });
	return runInInjectionContext(injector, function _Create() { return new OpenCraneConversationEventStream(); });
}

/** Uses deterministic timers without changing production refresh or rate-limit constants. */
function _Clock(): void { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-07T00:00:00.000Z")); }

afterEach(function _RestoreTimers() { vi.useRealTimers(); });

describe("OpenCraneConversationEventStream", function _DescribeHistoryEvents()
{
	it("reads initial history once and adopts SSE text while retaining the computer", async function _UsesEvents()
	{
		const events = _Events(_Frame("2", [_Entry("2")], { "payload-2": "Héllo" }));
		const get = vi.fn().mockResolvedValueOnce(_History(_Computer())).mockResolvedValueOnce(events);
		const controller = new AbortController();
		const result = await _Stream(get).stream({ conversationId: "conversation-1", signal: controller.signal, onUpdate(update)
		{
			if (update.state.nextPosition === "2")
				controller.abort();
		} });
		expect(result.entries.map(entry => entry.position)).toEqual(["1", "2"]);
		expect(result.payloads).toEqual({ "payload-1": "Hello", "payload-2": "Héllo" });
		expect(result.computer).toEqual(_Computer());
		expect(get.mock.calls[0]).toEqual(["/me/conversations/{conversationId}/history", { params: { path: { conversationId: "conversation-1" } }, signal: controller.signal }]);
		expect(get.mock.calls[1]).toEqual(["/me/conversations/{conversationId}/events", expect.objectContaining({ params: { path: { conversationId: "conversation-1" }, query: { afterPosition: "1" } }, headers: { Accept: "text/event-stream", "Last-Event-ID": "1" }, parseAs: "stream", signal: expect.any(AbortSignal) })]);
		expect(get).toHaveBeenCalledTimes(2);
		expect(events.cancel).toHaveBeenCalledOnce();
	});

	it("resumes a hidden-entry checkpoint after a normal close without consuming failure retries", async function _QuietReconnect()
	{
		_Clock();
		const get = vi.fn().mockResolvedValueOnce(_History()).mockResolvedValueOnce(_Events(_Frame("5", []), true)).mockResolvedValueOnce(_Events("", true)).mockResolvedValueOnce(_Events());
		const controller = new AbortController();
		const updates: ConversationEventStreamUpdate[] = [];
		const pending = _Stream(get).stream({ conversationId: "conversation-1", signal: controller.signal, maximumReconnectAttempts: 0, onUpdate(update) { updates.push(update); } });
		await vi.advanceTimersByTimeAsync(10_000);
		expect(get).toHaveBeenCalledTimes(4);
		expect(get.mock.calls[2]?.[1].params.query.afterPosition).toBe("5");
		expect(get.mock.calls[3]?.[1].params.query.afterPosition).toBe("5");
		expect(updates.some(update => update.status === ConversationEventStreamStatuses.Reconnecting || update.status === ConversationEventStreamStatuses.Failed)).toBe(false);
		controller.abort();
		await expect(pending).resolves.toMatchObject({ nextPosition: "5", entries: [_Entry()] });
	});

	it("cancels the quiet connection and refreshes computer state after thirty seconds", async function _RefreshComputer()
	{
		_Clock();
		const events = _Events();
		const get = vi.fn().mockResolvedValueOnce(_History(_Computer())).mockResolvedValueOnce(events).mockResolvedValueOnce({ ..._History(_Computer(ConversationComputerStates.Warm)), data: { ..._History(_Computer(ConversationComputerStates.Warm)).data, entries: [] } }).mockResolvedValueOnce(_Events());
		const controller = new AbortController();
		const updates: ConversationEventStreamUpdate[] = [];
		const pending = _Stream(get).stream({ conversationId: "conversation-1", signal: controller.signal, onUpdate(update) { updates.push(update); } });
		await vi.advanceTimersByTimeAsync(29_999);
		expect(get).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(events.cancel).toHaveBeenCalledOnce();
		expect(get.mock.calls[2]).toEqual(["/me/conversations/{conversationId}/history", { params: { path: { conversationId: "conversation-1" }, query: { afterPosition: "1" } }, signal: controller.signal }]);
		expect(get).toHaveBeenCalledTimes(4);
		expect(updates.at(-1)?.state.computer?.state).toBe(ConversationComputerStates.Warm);
		controller.abort();
		await pending;
	});

	it.each([401, 403, 404])("purges history immediately on HTTP %i", async function _AccessChanged(status)
	{
		const get = vi.fn().mockResolvedValueOnce(_History(_Computer())).mockResolvedValueOnce({ error: { error: "private reason" }, response: new Response(null, { status }) });
		const updates: ConversationEventStreamUpdate[] = [];
		const result = await _Stream(get).stream({ conversationId: "conversation-1", signal: new AbortController().signal, onUpdate(update) { updates.push(update); } });
		expect(result).toEqual({ entries: [], payloads: {}, nextPosition: "0", computer: null });
		expect(updates.at(-1)?.status).toBe(ConversationEventStreamStatuses.AccessChanged);
		expect(get).toHaveBeenCalledTimes(2);
	});

	it("purges a revoked stream without retrying its unavailable event", async function _RevokedEvent()
	{
		const get = vi.fn().mockResolvedValueOnce(_History()).mockResolvedValueOnce(_Events('event: unavailable\ndata: {"error":"conversation_unavailable"}\n\n'));
		const updates: ConversationEventStreamUpdate[] = [];
		const result = await _Stream(get).stream({ conversationId: "conversation-1", signal: new AbortController().signal, onUpdate(update) { updates.push(update); } });
		expect(result.entries).toEqual([]);
		expect(updates.at(-1)?.status).toBe(ConversationEventStreamStatuses.AccessChanged);
		expect(get).toHaveBeenCalledTimes(2);
	});

	it.each([
		'event: unavailable\ndata: {"error":"conversation_history_unavailable"}\n\n',
		'event: history\nid: 2\ndata: {invalid}\n\n',
		_Frame("2", [_Entry("2", "another-conversation")]),
		_Frame("0", []),
		_Frame("2").replace("id: 2", "id: 3")
	])("stops an invalid server frame without poisoning automatic retries", async function _InvalidEvent(frame)
	{
		const get = vi.fn().mockResolvedValueOnce(_History()).mockResolvedValueOnce(_Events(frame));
		const updates: ConversationEventStreamUpdate[] = [];
		await expect(_Stream(get).stream({ conversationId: "conversation-1", signal: new AbortController().signal, onUpdate(update) { updates.push(update); } })).rejects.toThrow("Conversation history is unavailable.");
		expect(updates.at(-1)?.state.entries).toEqual([_Entry()]);
		expect(updates.at(-1)?.status).toBe(ConversationEventStreamStatuses.Failed);
		expect(get).toHaveBeenCalledTimes(2);
	});

	it("honors Retry-After before reopening the accepted cursor", async function _RateLimited()
	{
		_Clock();
		const get = vi.fn().mockResolvedValueOnce(_History()).mockResolvedValueOnce({ error: {}, response: new Response(null, { status: 429, headers: { "Retry-After": "60" } }) }).mockResolvedValueOnce(_History()).mockResolvedValueOnce(_Events());
		const controller = new AbortController();
		const pending = _Stream(get).stream({ conversationId: "conversation-1", signal: controller.signal });
		await vi.advanceTimersByTimeAsync(59_999);
		expect(get).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(get).toHaveBeenCalledTimes(4);
		expect(get.mock.calls[3]?.[1].params.query.afterPosition).toBe("1");
		controller.abort();
		await pending;
	});

	it("bounds repeated read disconnects even when HTTP 200 opened each time", async function _DisconnectLimit()
	{
		_Clock();
		const get = vi.fn().mockResolvedValueOnce(_History()).mockImplementation(function _Disconnected() { return Promise.resolve(_Events("", false, true)); });
		const promise = _Stream(get).stream({ conversationId: "conversation-1", signal: new AbortController().signal, maximumReconnectAttempts: 1 });
		const assertion = expect(promise).rejects.toThrow("Conversation history is unavailable.");
		await vi.advanceTimersByTimeAsync(5_000);
		await assertion;
		expect(get).toHaveBeenCalledTimes(3);
	});

	it("cancels a late SSE response without publishing history for an aborted selection", async function _AbortPendingEvents()
	{
		_Clock();
		let resolve: (value: unknown) => void = function _Unassigned() { throw new Error("event request not started"); };
		const get = vi.fn().mockResolvedValueOnce(_History()).mockImplementationOnce(function _Pending() { return new Promise(function _Wait(accept) { resolve = accept; }); });
		const controller = new AbortController();
		const updates: ConversationEventStreamUpdate[] = [];
		const pending = _Stream(get).stream({ conversationId: "conversation-1", signal: controller.signal, onUpdate(update) { updates.push(update); } });
		await vi.advanceTimersByTimeAsync(0);
		expect(get).toHaveBeenCalledTimes(2);
		controller.abort();
		const events = _Events(_Frame());
		resolve(events);
		await pending;
		expect(events.cancel).toHaveBeenCalledOnce();
		expect(get.mock.calls[1]?.[1].signal.aborted).toBe(true);
		expect(updates.map(update => update.status)).toEqual([ConversationEventStreamStatuses.Connecting, ConversationEventStreamStatuses.Aborted]);
	});

	it("does not publish a late history response after selection abort", async function _AbortPendingHistory()
	{
		let resolve: (value: unknown) => void = function _Unassigned() { throw new Error("request not started"); };
		const get = vi.fn().mockImplementation(function _Pending() { return new Promise(function _Wait(accept) { resolve = accept; }); });
		const controller = new AbortController();
		const updates: ConversationEventStreamUpdate[] = [];
		const pending = _Stream(get).stream({ conversationId: "conversation-1", signal: controller.signal, onUpdate(update) { updates.push(update); } });
		controller.abort();
		resolve(_History());
		await pending;
		expect(updates.map(update => update.status)).toEqual([ConversationEventStreamStatuses.Connecting, ConversationEventStreamStatuses.Aborted]);
		expect(updates.at(-1)?.state.entries).toEqual([]);
		expect(get).toHaveBeenCalledTimes(1);
	});
});
