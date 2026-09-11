import { Injector, runInInjectionContext } from "@angular/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONTROL_PLANE_BASE_URL, CONTROL_PLANE_REQUEST_HEADERS, FLEET_MANAGER_BASE_URL } from "../api-client.types";
import { ControlPlaneApiService } from "../control-plane-api.service";
import { FleetManagerApiService } from "../fleet-manager-api.service";

/** Origin used across the cases; a distinct host proves the URL is absolute. */
const _ORIGIN = "https://cp.example";

/**
 * Constructs the service inside an injection context with a configured
 * `CONTROL_PLANE_BASE_URL`, so DI-injected fields resolve without `TestBed`.
 *
 * @returns A fresh {@link ControlPlaneApiService} bound to {@link _ORIGIN}.
 */
function _makeService(): ControlPlaneApiService
{
	const injector = Injector.create({ providers: [{ provide: CONTROL_PLANE_BASE_URL, useValue: _ORIGIN }, ControlPlaneApiService] });
	return runInInjectionContext(injector, function _resolve(): ControlPlaneApiService
	{
		return injector.get(ControlPlaneApiService);
	});
}

describe("ControlPlaneApiService.signInUrl", () =>
{
	afterEach(function _RestoreFetch(): void
	{
		vi.unstubAllGlobals();
	});

	it("builds the login URL against the configured API base", () =>
	{
		const service = _makeService();

		expect(service.signInUrl("/dashboard")).toBe(`${_ORIGIN}/api/v1/auth/login?returnTo=${encodeURIComponent("/dashboard")}`);
	});

	it("percent-encodes the returnTo (slash, query, ampersand)", () =>
	{
		const service = _makeService();
		const returnTo = "/threads/t1?view=session&tab=context";

		const url = service.signInUrl(returnTo);

		expect(url).toBe(`${_ORIGIN}/api/v1/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
		// The raw separators must not leak into the outer query string.
		expect(url).toContain("returnTo=%2Fthreads%2Ft1%3Fview%3Dsession%26tab%3Dcontext");
		expect(url.indexOf("?")).toBe(url.lastIndexOf("?"));
	});

	it("adds application headers to typed, state-changing, SSE, and transitional requests", async function _ApplicationHeaders(): Promise<void>
	{
		const requests: Request[] = [];
		vi.stubGlobal("fetch", vi.fn(async function _Fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
		{
			const request = new Request(input, init);
			requests.push(request);
			if (request.url.endsWith("/events"))
			{
				return new Response("", { status: 200, headers: { "Content-Type": "text/event-stream" } });
			}
			if (request.url.endsWith("/auth/logout"))
			{
				return new Response(null, { status: 204 });
			}
			return new Response(JSON.stringify({ authenticated: false, mode: "oidc", user: null }), { status: 200, headers: { "Content-Type": "application/json" } });
		}));
		const credential = "private-development-session";
		const injector = Injector.create({ providers: [
			{ provide: CONTROL_PLANE_BASE_URL, useValue: _ORIGIN },
			{ provide: CONTROL_PLANE_REQUEST_HEADERS, useValue: { "X-OpenCrane-Development-Session": credential } },
			ControlPlaneApiService,
		] });
		const service = runInInjectionContext(injector, function _Resolve(): ControlPlaneApiService { return injector.get(ControlPlaneApiService); });

		await service.client.GET("/auth/me", {});
		await service.client.POST("/auth/logout");
		await service.client.GET("/me/conversations/{conversationId}/events", { params: { path: { conversationId: "conversation-1" }, query: { afterPosition: "0" } }, headers: { Accept: "text/event-stream" }, parseAs: "stream" });
		await service.request("POST", "/transitional", { body: { value: true } });

		expect(requests).toHaveLength(4);
		for (const request of requests)
		{
			expect(request.headers.get("X-OpenCrane-Development-Session")).toBe(credential);
		}
	});
});

describe("FleetManagerApiService.signInUrl", () =>
{
	/** A distinct origin proves the fleet client signs in against its OWN host, not the opencrane-ui's. */
	const _FLEET_ORIGIN = "https://fleet.example";

	it("builds the login URL against the fleet API base (self-contained auth, no opencrane-ui delegation)", () =>
	{
		const injector = Injector.create({ providers: [{ provide: FLEET_MANAGER_BASE_URL, useValue: _FLEET_ORIGIN }, FleetManagerApiService] });
		const service = runInInjectionContext(injector, function _resolve(): FleetManagerApiService
		{
			return injector.get(FleetManagerApiService);
		});

		expect(service.signInUrl("/customers")).toBe(`${_FLEET_ORIGIN}/api/v1/auth/login?returnTo=${encodeURIComponent("/customers")}`);
	});
});
