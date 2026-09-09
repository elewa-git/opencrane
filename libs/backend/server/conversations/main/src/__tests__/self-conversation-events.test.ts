import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { _CreateSelfConversationEventsHandler } from "../self-conversation-events";
import type { SelfConversationEventLimits } from "../self-conversation-events.types";
import type { SelfConversationHistoryAuthority } from "../self-conversation-history.types";

const _CALLER = { siloId: "silo-1", subjectId: "subject-1", principalId: "principal-1" };

class _Response extends EventEmitter
{
	statusCode = 200;
	headersSent = false;
	writableEnded = false;
	backpressure = false;
	headers: Record<string, string> = {};
	frames: string[] = [];
	body: unknown;
	status(code: number) { this.statusCode = code; return this; }
	set(name: string | Record<string, string>, value?: string) { Object.assign(this.headers, typeof name === "string" ? { [name]: value } : name); return this; }
	json(value: unknown) { this.body = value; this.end(); return this; }
	flushHeaders() { this.headersSent = true; }
	write(frame: string) { this.frames.push(frame); return !this.backpressure; }
	end()
	{
		if (!this.writableEnded)
		{
			this.writableEnded = true;
			this.emit("close");
		}
		return this;
	}
}

function _Page(position: string, payloads: Record<string, string> = {})
{
	return { entries: [], payloads, nextPosition: position, computer: null };
}

function _Harness(limits: Partial<SelfConversationEventLimits> = {})
{
	const events = new PassThrough({ objectMode: true });
	const close = vi.fn(async function _Close() { events.end(); });
	const subscribe = vi.fn().mockResolvedValue({ events, close });
	const read = vi.fn<SelfConversationHistoryAuthority["read"]>(async function _Read(_caller, _id, cursor) { return _Page(cursor?.toString() ?? "0"); });
	const shutdown = new AbortController();
	const resolveCaller = vi.fn().mockReturnValue(_CALLER);
	const warn = vi.fn();
	const handler = _CreateSelfConversationEventsHandler({ authority: { read }, historyStore: { subscribe }, resolveCaller, shutdownSignal: shutdown.signal, logger: { warn }, limits: { durationMs: 2000, idleMs: 1500, heartbeatMs: 1000, ...limits } });
	function _Start(headers: Record<string, string> = {}, query: Record<string, string> = {}, response = new _Response())
	{
		const allHeaders: Record<string, string> = { host: "opencrane.test", "sec-fetch-site": "same-origin", ...headers };
		const request = { protocol: "https", params: { conversationId: "conversation-1" }, query, get: function _Get(name: string) { return allHeaders[name]; } } as unknown as Request;
		handler(request, response as unknown as Response, vi.fn());
		return response;
	}
	return { read, subscribe, close, events, shutdown, resolveCaller, warn, start: _Start };
}

async function _Ended(response: _Response)
{
	await vi.waitFor(function _ExpectEnd() { expect(response.writableEnded).toBe(true); }, { timeout: 1000, interval: 5 });
}

describe("participant conversation SSE", function ()
{
	it("records one safe failure diagnostic without including upstream exception content", async function ()
	{
		const harness = _Harness();
		harness.read.mockRejectedValueOnce(new Error("PRIVATE_PROVIDER_RESPONSE"));
		const response = harness.start();
		await _Ended(response);
		expect(response.statusCode).toBe(503);
		expect(harness.warn).toHaveBeenCalledOnce();
		expect(harness.warn).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error), failedOperation: "history.read", siloId: "silo-1", conversationId: "conversation-1" }), expect.any(String));
		expect(harness.warn.mock.calls[0]![0].err.message).toBe("Conversation event stream failed");
		expect(JSON.stringify(harness.warn.mock.calls)).not.toContain("PRIVATE_PROVIDER_RESPONSE");
	});

	it("denies unauthenticated, foreign-origin, and malformed replay requests before opening history", function ()
	{
		const harness = _Harness();
		harness.resolveCaller.mockReturnValueOnce(null);
		expect(harness.start().statusCode).toBe(401);
		expect(harness.start({ origin: "https://other.test" }).statusCode).toBe(403);
		expect(harness.start({ "sec-fetch-site": "same-site" }).statusCode).toBe(403);
		expect(harness.start({ "last-event-id": "1,2" }).statusCode).toBe(400);
		expect(harness.start({}, { afterPosition: "18446744073709551616" }).statusCode).toBe(400);
		expect(harness.read).not.toHaveBeenCalled();
		expect(harness.subscribe).not.toHaveBeenCalled();
	});

	it("resumes after Last-Event-ID despite the original URL cursor and emits only authorized page data", async function ()
	{
		const harness = _Harness({ eventCount: 1 });
		harness.read.mockResolvedValueOnce(_Page("8", { visible: "hello" }));
		const response = harness.start({ "last-event-id": "7" }, { afterPosition: "0" });
		await _Ended(response);
		expect(harness.read).toHaveBeenCalledWith(_CALLER, "conversation-1", 7n, expect.objectContaining({ maxCount: 1, signal: expect.any(AbortSignal) }));
		expect(harness.subscribe).toHaveBeenCalledWith({ streamName: "conversation-conversation-1", fromRevision: 9n });
		expect(response.frames).toEqual(['id: 8\nevent: history\ndata: {"entries":[],"payloads":{"visible":"hello"},"nextPosition":"8","computer":null}\n\n']);
		expect(harness.close).toHaveBeenCalledOnce();
	});

	it("catches an append between history and subscription without exposing its raw envelope", async function ()
	{
		const harness = _Harness({ eventCount: 1 });
		harness.read.mockResolvedValueOnce(_Page("0")).mockResolvedValueOnce(_Page("1"));
		const response = harness.start();
		await vi.waitFor(function _Opened() { expect(harness.subscribe).toHaveBeenCalledOnce(); });
		harness.events.write({ streamName: "conversation-conversation-1", revision: 1n, metadata: { siloId: "silo-1", conversationId: "conversation-1", internal: "NEVER_EXPOSE" }, data: { internal: "NEVER_EXPOSE" } });
		await _Ended(response);
		expect(response.frames.join("")).toContain("id: 1");
		expect(response.frames.join("")).not.toContain("NEVER_EXPOSE");
		expect(harness.close).toHaveBeenCalledOnce();
	});

	it("refreshes authority while idle and closes after revocation", async function ()
	{
		const harness = _Harness({ heartbeatMs: 5 });
		harness.read.mockResolvedValueOnce(_Page("0")).mockResolvedValueOnce(null as never);
		const response = harness.start();
		await _Ended(response);
		expect(harness.read).toHaveBeenCalledTimes(2);
		expect(response.frames.join("")).not.toContain("event: history");
		expect(harness.close).toHaveBeenCalledOnce();
	});

	it("cancels an in-flight catch-up and its subscription on browser disconnect", async function ()
	{
		const harness = _Harness();
		let aborted = false;
		harness.read.mockResolvedValueOnce(_Page("1")).mockImplementationOnce(async function _Pending(_caller, _id, _cursor, options)
		{
			return new Promise(function _Wait(_resolve, reject) { options!.signal.addEventListener("abort", function _Abort() { aborted = true; reject(new Error("cancelled")); }, { once: true }); });
		});
		const response = harness.start();
		await vi.waitFor(function _Reading() { expect(harness.read).toHaveBeenCalledTimes(2); });
		response.emit("close");
		await _Ended(response);
		expect(aborted).toBe(true);
		expect(harness.close).toHaveBeenCalledOnce();
		expect(harness.warn).not.toHaveBeenCalled();
	});

	it("ends slow and oversized responses without reading an unbounded backlog", async function ()
	{
		const slow = _Harness({ drainMs: 5 });
		slow.read.mockResolvedValueOnce(_Page("1"));
		const response = new _Response();
		response.backpressure = true;
		slow.start({}, {}, response);
		await _Ended(response);
		expect(slow.read).toHaveBeenCalledOnce();
		expect(slow.close).toHaveBeenCalledOnce();
		expect(slow.warn).not.toHaveBeenCalled();
		const large = _Harness({ eventBytes: 512 });
		large.read.mockResolvedValueOnce(_Page("1", { text: "x".repeat(1000) }));
		const oversized = large.start();
		await _Ended(oversized);
		expect(oversized.frames.join("")).toContain("event: unavailable");
		expect(oversized.frames.join("")).not.toContain("x".repeat(1000));
		expect(large.close).toHaveBeenCalledOnce();
	});

	it("enforces duration, idle, and response byte budgets", async function ()
	{
		for (const limits of [{ durationMs: 5 }, { idleMs: 5 }, { responseBytes: 10, heartbeatMs: 5 }])
		{
			const harness = _Harness(limits);
			await _Ended(harness.start());
			expect(harness.close).toHaveBeenCalledOnce();
			expect(harness.warn).not.toHaveBeenCalled();
		}
	});

	it("limits active streams and repeated starts by verified silo and subject", async function ()
	{
		const harness = _Harness({ subjectConnections: 1, subjectStartsPerMinute: 1 });
		const first = harness.start();
		await vi.waitFor(function _Opened() { expect(harness.subscribe).toHaveBeenCalledOnce(); });
		expect(harness.start().statusCode).toBe(429);
		first.emit("close");
		await _Ended(first);
		expect(harness.start().statusCode).toBe(429);
		expect(harness.close).toHaveBeenCalledOnce();
	});
});
