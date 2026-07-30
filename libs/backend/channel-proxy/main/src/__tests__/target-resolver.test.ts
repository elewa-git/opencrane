import { describe, expect, it, vi } from "vitest";

import { __OpenCraneTargetResolver } from "../target-resolver.js";

describe("OpenCrane channel target resolver", () =>
{
	it("uses the rotating workload token and delegates only session inputs", async () =>
	{
		const transport = vi.fn(async function _fetch(_input: RequestInfo | URL, init?: RequestInit)
		{
			const headers = new Headers(init?.headers);
			expect(headers.get("authorization")).toBe("Bearer workload-token");
			expect(headers.get("cookie")).toBe("session=opaque");
			expect(headers.get("x-opencrane-session-authorization")).toBe("Bearer user-token");
			expect(JSON.parse(String(init?.body))).toEqual({ action: "events.read", trustedHost: "acme.example.com", threadId: "thread-1" });
			return Response.json({
				subjectId: "subject-1",
				endpoint: "http://agent-runtime.default.svc.cluster.local:8080/v1/events",
				invocationContext: "short-lived-context",
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			});
		}) as unknown as typeof fetch;
		const readFile = vi.fn(async function _readFile() { return "workload-token\n"; });
		const resolver = new __OpenCraneTargetResolver({ baseUrl: "http://opencrane.default.svc.cluster.local:8081", fetch: transport, readFile });
		const result = await resolver.resolve({ action: "events.read", threadId: "thread-1", session: { cookie: "session=opaque", authorization: "Bearer user-token", trustedHost: "acme.example.com" } }, new AbortController().signal);
		expect(result.subjectId).toBe("subject-1");
		expect(readFile).toHaveBeenCalledOnce();
	});

	it("forwards only the command coordinates that OpenCrane must bind before admission", async function _ForwardsCommandCoordinates()
	{
		const transport = vi.fn(async function _fetch(_input: RequestInfo | URL, init?: RequestInit)
		{
			expect(JSON.parse(String(init?.body))).toEqual({ action: "command.forward", trustedHost: "acme.example.com", threadId: "thread-1", requestIdempotencyKey: "delivery-1" });
			return Response.json({ subjectId: "subject-1", endpoint: "http://agent-runtime.default.svc.cluster.local:8080/v1/commands", invocationContext: "short-lived-context", expiresAt: new Date(Date.now() + 60_000).toISOString() });
		}) as unknown as typeof fetch;
		const resolver = new __OpenCraneTargetResolver({ baseUrl: "http://opencrane.default.svc.cluster.local:8081", fetch: transport, readFile: async function _readFile() { return "workload-token"; } });

		await resolver.resolve({ action: "command.forward", threadId: "thread-1", requestIdempotencyKey: "delivery-1", session: { cookie: "session=opaque", trustedHost: "acme.example.com" } }, new AbortController().signal);

		expect(transport).toHaveBeenCalledOnce();
	});

	it("rejects expired resolver output", async () =>
	{
		const transport = vi.fn(async function _fetch()
		{
			return Response.json({ subjectId: "subject-1", endpoint: "http://runtime.default.svc.cluster.local/events", invocationContext: "context", expiresAt: "2020-01-01T00:00:00.000Z" });
		}) as unknown as typeof fetch;
		const resolver = new __OpenCraneTargetResolver({ baseUrl: "http://opencrane.default.svc.cluster.local:8081", fetch: transport, readFile: async function _readFile() { return "token"; } });
		await expect(resolver.resolve({ action: "command.forward", threadId: "thread-1", requestIdempotencyKey: "delivery-1", session: { cookie: "session=opaque", trustedHost: "acme.example.com" } }, new AbortController().signal)).rejects.toThrow("expired");
	});

	it("rejects invalid JSON and structurally untrusted resolver output", async function _RejectsInvalidResponses()
	{
		const request = { action: "command.forward" as const, threadId: "thread-1", requestIdempotencyKey: "delivery-1", session: { cookie: "session=opaque", trustedHost: "acme.example.com" } };
		const invalidJson = new __OpenCraneTargetResolver({ baseUrl: "http://opencrane.default.svc.cluster.local:8081", fetch: vi.fn().mockResolvedValue(new Response("{", { status: 200 })) as unknown as typeof fetch, readFile: async function _ReadFile() { return "token"; } });
		await expect(invalidJson.resolve(request, new AbortController().signal)).rejects.toThrow(/channel target response must contain valid JSON/);

		const invalidShape = new __OpenCraneTargetResolver({ baseUrl: "http://opencrane.default.svc.cluster.local:8081", fetch: vi.fn().mockResolvedValue(Response.json([])) as unknown as typeof fetch, readFile: async function _ReadFile() { return "token"; } });
		await expect(invalidShape.resolve(request, new AbortController().signal)).rejects.toThrow(/not an object/);
	});
});
