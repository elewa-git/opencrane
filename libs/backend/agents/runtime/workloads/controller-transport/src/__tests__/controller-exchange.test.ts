import { describe, expect, it, vi } from "vitest";

import { __CreateControllerExchange, __RequireControllerRouteId } from "../controller-exchange";

/** Builds one exchange with a controlled token reader and fetch. */
function _Exchange(response: Response)
{
	const fetch = vi.fn().mockResolvedValue(response);
	const exchange = __CreateControllerExchange("test domain", {
		openCraneInternalUrl: "http://opencrane.opencrane.svc.cluster.local",
		serverServiceName: "opencrane",
		serverNamespace: "opencrane",
		tokenPath: "/var/run/opencrane/controller.token",
		requestTimeoutMilliseconds: 1_000,
		fetch,
		async readToken()
		{
			return "controller-token";
		},
	});
	return { exchange, fetch };
}

/** Returns the request every test sends unless it overrides a field. */
function _Request()
{
	return { path: "/api/internal/test/claim", method: "POST" as const, body: { key: "value" }, failure: "test claim", parse: function _Parse(value: unknown) { return value as { ok: boolean }; } };
}

describe("controller exchange", function _DescribeControllerExchange()
{
	it("rejects an origin that does not name the configured server Service", function _RejectsUntrustedOrigin()
	{
		expect(function _CreateUntrusted()
		{
			return __CreateControllerExchange("test domain", { openCraneInternalUrl: "http://example.invalid", serverServiceName: "opencrane", serverNamespace: "opencrane", tokenPath: "/var/run/opencrane/controller.token", requestTimeoutMilliseconds: 1_000 });
		}).toThrow(/in-cluster HTTP origin/);
	});

	it("rejects a relative token path and an out-of-range timeout", function _RejectsBadOptions()
	{
		expect(function _CreateRelativeToken()
		{
			return __CreateControllerExchange("test domain", { openCraneInternalUrl: "http://opencrane.opencrane.svc.cluster.local", serverServiceName: "opencrane", serverNamespace: "opencrane", tokenPath: "relative.token", requestTimeoutMilliseconds: 1_000 });
		}).toThrow(/absolute token path/);
		expect(function _CreateLongTimeout()
		{
			return __CreateControllerExchange("test domain", { openCraneInternalUrl: "http://opencrane.opencrane.svc.cluster.local", serverServiceName: "opencrane", serverNamespace: "opencrane", tokenPath: "/var/run/token", requestTimeoutMilliseconds: 61_000 });
		}).toThrow(/1-60s timeout/);
	});

	it("sends the bearer token and parses a validated 200 body", async function _ParsesSuccess()
	{
		const { exchange, fetch } = _Exchange(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));

		await expect(exchange.exchange(_Request())).resolves.toEqual({ ok: true });

		const request = fetch.mock.calls[0]?.[0] as URL;
		const init = fetch.mock.calls[0]?.[1] as RequestInit;
		expect(request.pathname).toBe("/api/internal/test/claim");
		expect(new Headers(init.headers).get("authorization")).toBe("Bearer controller-token");
		expect(init.body).toBe(JSON.stringify({ key: "value" }));
	});

	it("returns the caller's conflict sentinel on 409 and fails closed when none is declared", async function _MapsConflict()
	{
		const withSentinel = _Exchange(new Response(null, { status: 409 }));
		await expect(withSentinel.exchange.exchange({ ..._Request(), conflict: null })).resolves.toBeNull();

		const withoutSentinel = _Exchange(new Response(null, { status: 409 }));
		await expect(withoutSentinel.exchange.exchange(_Request())).rejects.toThrow(/test claim failed with HTTP 409/);
	});

	it("returns the caller's no-content value on 204 and fails closed when none is declared", async function _MapsNoContent()
	{
		const withValue = _Exchange(new Response(null, { status: 204 }));
		await expect(withValue.exchange.exchange<{ ok: boolean } | null>({ ..._Request(), noContent: null })).resolves.toBeNull();

		const withoutValue = _Exchange(new Response(null, { status: 204 }));
		await expect(withoutValue.exchange.exchange(_Request())).rejects.toThrow(/test claim failed with HTTP 204/);
	});

	it("bounds a response that exceeds 16 KiB", async function _BoundsResponse()
	{
		const { exchange } = _Exchange(new Response("x".repeat(17 * 1024), { status: 200 }));

		await expect(exchange.exchange(_Request())).rejects.toThrow(/exceeded the 16 KiB boundary/);
	});

	it("requires one bounded route identity", function _RequiresRouteId()
	{
		expect(__RequireControllerRouteId("validation-1", "validation id")).toBe("validation-1");
		expect(function _Empty() { return __RequireControllerRouteId("", "validation id"); }).toThrow(/one valid validation id/);
		expect(function _Long() { return __RequireControllerRouteId("x".repeat(129), "validation id"); }).toThrow(/one valid validation id/);
	});
});
