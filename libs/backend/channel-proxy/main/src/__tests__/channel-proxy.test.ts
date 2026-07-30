import { describe, expect, it, vi } from "vitest";

import type { AuthorizedChannelTarget, ChannelProxyDependencies, ChannelTargetResolver, SubjectRateLimiter, TargetResolutionRequest } from "../channel-proxy.types.js";
import { __ForwardCommand, __RelayEvents } from "../forwarding.js";
import { __HasForgedIdentityHeaders, __ValidateOrigin } from "../origin-policy.js";
import { __FixedWindowRateLimiter } from "../rate-limiter.js";

/** Construct a live authorized target for one focused test. */
function _Target(endpoint = "http://agent-runtime.default.svc.cluster.local:8080/v1/channel"): AuthorizedChannelTarget
{
	return { subjectId: "subject-1", endpoint, invocationContext: "short-lived-context", expiresAt: new Date(Date.now() + 60_000).toISOString() };
}

/** Construct the domain dependencies with explicit test doubles. */
function _Dependencies(resolve: ChannelTargetResolver["resolve"], transport: typeof fetch, rateLimiter: SubjectRateLimiter = { allow: function _allow() { return true; } }): ChannelProxyDependencies
{
	return {
		config: {
			allowedOrigins: new Set(["https://acme.example.com"]),
			allowedTargetHostSuffixes: [".svc.cluster.local"],
			maxCommandBytes: 256,
			maxCommandResponseBytes: 256,
			commandTimeoutMs: 20,
			streamConnectTimeoutMs: 20,
			streamDurationMs: 2_000,
			streamIdleTimeoutMs: 100,
			maxEventBytes: 256,
		},
		resolver: { resolve },
		rateLimiter,
		fetch: transport,
	};
}

/** Construct one same-origin authenticated public request. */
function _Request(path: string, init: RequestInit = {}): Request
{
	const headers = new Headers(init.headers);
	headers.set("origin", "https://acme.example.com");
	headers.set("host", "acme.example.com");
	headers.set("cookie", "session=opaque");
	if (!headers.has("idempotency-key")) headers.set("idempotency-key", "delivery-1");
	return new Request(`https://acme.example.com${path}`, { ...init, headers });
}

/** Returns the smallest valid command envelope while leaving its user payload opaque to the proxy. */
function _CommandBody(): string
{
	return JSON.stringify({ threadId: "thread-1", content: { text: "hello" } });
}

describe("channel proxy public boundary", () =>
{
	it("accepts only an exact same-origin HTTPS host", () =>
	{
		const allowed = new Set(["https://acme.example.com"]);
		expect(__ValidateOrigin("https://acme.example.com", "acme.example.com", allowed)).toBe("acme.example.com");
		expect(__ValidateOrigin("https://other.example.com", "other.example.com", allowed)).toBeNull();
		expect(__ValidateOrigin("https://acme.example.com", "other.example.com", allowed)).toBeNull();
		expect(__ValidateOrigin(null, "acme.example.com", allowed)).toBeNull();
	});

	it("recognizes forged public identity assertions", () =>
	{
		expect(__HasForgedIdentityHeaders(new Headers({ "x-opencrane-subject": "admin" }))).toBe(true);
		expect(__HasForgedIdentityHeaders(new Headers({ cookie: "session=opaque" }))).toBe(false);
	});

	it("bounds authenticated subjects per window", () =>
	{
		let now = 1_000;
		const limiter = new __FixedWindowRateLimiter(2, 1_000, { now: function _now() { return now; } });
		expect(limiter.allow("subject-1")).toBe(true);
		expect(limiter.allow("subject-1")).toBe(true);
		expect(limiter.allow("subject-1")).toBe(false);
		now = 2_000;
		expect(limiter.allow("subject-1")).toBe(true);
	});

	it("rejects forged identity before target resolution", async () =>
	{
		const resolve = vi.fn(async function _resolve() { return _Target(); });
		const request = _Request("/v1/commands", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-user": "admin" }, body: _CommandBody() });
		const response = await __ForwardCommand(request, _Dependencies(resolve, vi.fn() as unknown as typeof fetch));
		expect(response.status).toBe(400);
		expect(resolve).not.toHaveBeenCalled();
	});

	it("fails closed when OpenCrane target resolution is unavailable", async () =>
	{
		const resolve = vi.fn(async function _resolve(): Promise<AuthorizedChannelTarget> { throw new Error("offline"); });
		const request = _Request("/v1/commands", { method: "POST", headers: { "content-type": "application/json" }, body: _CommandBody() });
		const response = await __ForwardCommand(request, _Dependencies(resolve, vi.fn() as unknown as typeof fetch));
		expect(response.status).toBe(503);
	});

	it("times out an unresponsive command target", async () =>
	{
		const resolve = vi.fn(async function _resolve() { return _Target(); });
		const transport = vi.fn(async function _fetch(_input: RequestInfo | URL, init?: RequestInit): Promise<Response>
		{
			return new Promise<Response>(function _wait(_resolve, reject)
			{
				init?.signal?.addEventListener("abort", function _abort() { reject(init.signal?.reason); }, { once: true });
			});
		}) as unknown as typeof fetch;
		const request = _Request("/v1/commands", { method: "POST", headers: { "content-type": "application/json" }, body: _CommandBody() });
		const response = await __ForwardCommand(request, _Dependencies(resolve, transport));
		expect(response.status).toBe(504);
	});

	it("rejects an oversized command response", async () =>
	{
		const resolve = vi.fn(async function _resolve() { return _Target(); });
		const transport = vi.fn(async function _fetch() { return new Response("x".repeat(257)); }) as unknown as typeof fetch;
		const request = _Request("/v1/commands", { method: "POST", headers: { "content-type": "application/json" }, body: _CommandBody() });
		const response = await __ForwardCommand(request, _Dependencies(resolve, transport));
		expect(response.status).toBe(502);
	});

	it("binds a command route decision to its canonical thread and transport delivery key", async function _BindsCommandCoordinates()
	{
		let resolved: TargetResolutionRequest | undefined;
		const resolve = vi.fn(async function _resolve(request: TargetResolutionRequest)
		{
			resolved = request;
			return _Target();
		});
		const transport = vi.fn(async function _fetch() { return Response.json({ accepted: true }); }) as unknown as typeof fetch;

		const response = await __ForwardCommand(_Request("/v1/commands", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "delivery-77" }, body: _CommandBody() }), _Dependencies(resolve, transport));

		expect(response.status).toBe(200);
		expect(resolved).toMatchObject({ action: "command.forward", threadId: "thread-1", requestIdempotencyKey: "delivery-77" });
	});

	it("rejects a command that lacks its transport delivery key before target resolution", async function _RejectsMissingCommandCoordinates()
	{
		const resolve = vi.fn(async function _resolve() { return _Target(); });
		const request = _Request("/v1/commands", { method: "POST", headers: { "content-type": "application/json" }, body: _CommandBody() });
		request.headers.delete("idempotency-key");

		const response = await __ForwardCommand(request, _Dependencies(resolve, vi.fn() as unknown as typeof fetch));

		expect(response.status).toBe(400);
		expect(resolve).not.toHaveBeenCalled();
	});

	it("rejects malformed and non-object command JSON before target resolution", async function _RejectsInvalidCommandJson()
	{
		const resolve = vi.fn(async function _Resolve() { return _Target(); });
		const dependencies = _Dependencies(resolve, vi.fn() as unknown as typeof fetch);
		const malformed = await __ForwardCommand(_Request("/v1/commands", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }), dependencies);
		const array = await __ForwardCommand(_Request("/v1/commands", { method: "POST", headers: { "content-type": "application/json" }, body: "[]" }), dependencies);

		expect(malformed.status).toBe(400);
		expect(array.status).toBe(400);
		expect(resolve).not.toHaveBeenCalled();
	});
});

describe("channel proxy SSE relay", () =>
{
	it("binds one replay cursor to authorization and the upstream request", async () =>
	{
		let resolved: TargetResolutionRequest | undefined;
		const resolve = vi.fn(async function _resolve(request: TargetResolutionRequest)
		{
			resolved = request;
			return _Target("http://agent-runtime.default.svc.cluster.local:8080/v1/events");
		});
		let upstreamCursor: string | null = null;
		const transport = vi.fn(async function _fetch(_input: RequestInfo | URL, init?: RequestInit): Promise<Response>
		{
			upstreamCursor = new Headers(init?.headers).get("last-event-id");
			return new Response("id: event-8\ndata: {}\n\n", { headers: { "content-type": "text/event-stream" } });
		}) as unknown as typeof fetch;
		const response = await __RelayEvents(_Request("/v1/events?threadId=thread-1&cursor=event-7"), _Dependencies(resolve, transport));
		expect(response.status).toBe(200);
		expect(await response.text()).toContain("id: event-8");
		expect(resolved?.cursor).toBe("event-7");
		expect(resolved?.threadId).toBe("thread-1");
		expect(upstreamCursor).toBe("event-7");
	});

	it("rejects conflicting replay cursors before authorization", async () =>
	{
		const resolve = vi.fn(async function _resolve() { return _Target(); });
		const request = _Request("/v1/events?threadId=thread-1&cursor=event-7", { headers: { "last-event-id": "event-8" } });
		const response = await __RelayEvents(request, _Dependencies(resolve, vi.fn() as unknown as typeof fetch));
		expect(response.status).toBe(400);
		expect(resolve).not.toHaveBeenCalled();
	});

	it("cancels the upstream stream when the downstream disconnects", async () =>
	{
		let cancelled = false;
		const upstream = new ReadableStream<Uint8Array>({
			cancel: function _cancel() { cancelled = true; },
		});
		const resolve = vi.fn(async function _resolve() { return _Target("http://agent-runtime.default.svc.cluster.local:8080/v1/events"); });
		const transport = vi.fn(async function _fetch() { return new Response(upstream, { headers: { "content-type": "text/event-stream" } }); }) as unknown as typeof fetch;
		const abort = new AbortController();
		const request = _Request("/v1/events?threadId=thread-1", { signal: abort.signal });
		const response = await __RelayEvents(request, _Dependencies(resolve, transport));
		const read = response.body?.getReader().read();
		abort.abort(new Error("client disconnected"));
		await expect(read).rejects.toThrow("client disconnected");
		expect(cancelled).toBe(true);
	});

	it("terminates an oversized SSE event", async () =>
	{
		const resolve = vi.fn(async function _resolve() { return _Target("http://agent-runtime.default.svc.cluster.local:8080/v1/events"); });
		const transport = vi.fn(async function _fetch() { return new Response(`data: ${"x".repeat(300)}\n\n`, { headers: { "content-type": "text/event-stream" } }); }) as unknown as typeof fetch;
		const response = await __RelayEvents(_Request("/v1/events?threadId=thread-1"), _Dependencies(resolve, transport));
		await expect(response.text()).rejects.toThrow("byte bound");
	});
});
