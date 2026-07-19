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
	return new Request(`https://acme.example.com${path}`, { ...init, headers });
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
		const request = _Request("/v1/commands", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-user": "admin" }, body: "{}" });
		const response = await __ForwardCommand(request, _Dependencies(resolve, vi.fn() as unknown as typeof fetch));
		expect(response.status).toBe(400);
		expect(resolve).not.toHaveBeenCalled();
	});

	it("fails closed when OpenCrane target resolution is unavailable", async () =>
	{
		const resolve = vi.fn(async function _resolve(): Promise<AuthorizedChannelTarget> { throw new Error("offline"); });
		const request = _Request("/v1/commands", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
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
		const request = _Request("/v1/commands", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
		const response = await __ForwardCommand(request, _Dependencies(resolve, transport));
		expect(response.status).toBe(504);
	});

	it("rejects an oversized command response", async () =>
	{
		const resolve = vi.fn(async function _resolve() { return _Target(); });
		const transport = vi.fn(async function _fetch() { return new Response("x".repeat(257)); }) as unknown as typeof fetch;
		const request = _Request("/v1/commands", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
		const response = await __ForwardCommand(request, _Dependencies(resolve, transport));
		expect(response.status).toBe(502);
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
