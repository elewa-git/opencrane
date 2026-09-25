import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ___CreateControlPlaneClient } from "@opencrane/contracts";
import { ControlPlaneApiService } from "@opencrane/core";
import { GovernanceReadError, GovernanceReadErrorKinds } from "@opencrane/state/governance";

import { OpenCraneGovernanceReadGateway } from "../opencrane-governance-read.gateway";

beforeAll(function _InitializeAngularTesting(): void
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
});

afterEach(function _ResetAngularTesting(): void
{
	TestBed.resetTestingModule();
	vi.unstubAllGlobals();
});

/** Uses the actual generated HTTP client with an isolated fetch boundary, never a live service. */
function _Gateway(fetch: ReturnType<typeof vi.fn>): OpenCraneGovernanceReadGateway
{
	vi.stubGlobal("fetch", fetch);
	const client = ___CreateControlPlaneClient("https://opencrane.test/api/v1");
	TestBed.configureTestingModule({ providers: [OpenCraneGovernanceReadGateway, { provide: ControlPlaneApiService, useValue: { client } }] });
	return TestBed.inject(OpenCraneGovernanceReadGateway);
}

/** Builds the public JSON response consumed by the generated parser. */
function _Json(body: unknown, status = 200): Response
{
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("governance read adapter", function _Adapter()
{
	it("uses only the four generated GET paths, passing opaque audit query and session credentials", async function _ReadPaths()
	{
		const page = { data: [], pagination: { limit: 5, hasMore: true, nextCursor: "next-cursor" } };
		const usage = [{ userId: "account-1", inputTokens: 0, outputTokens: 2, totalTokens: 2, currency: "KES", totalCost: 0, budgetCeiling: 0 }];
		const globalBudget = { currency: "USD", ceilingAmount: 0 };
		const accounts = [{ userId: "account-1", currency: "KES", ceilingAmount: 1000 }];
		const fetch = vi.fn().mockResolvedValueOnce(_Json(page)).mockResolvedValueOnce(_Json(usage)).mockResolvedValueOnce(_Json(globalBudget)).mockResolvedValueOnce(_Json(accounts));
		const gateway = _Gateway(fetch);
		const controller = new AbortController();
		await expect(gateway.readAuditPage({ limit: 5, cursor: "opaque_cursor" }, controller.signal)).resolves.toEqual(page);
		await expect(gateway.readTokenUsage(controller.signal)).resolves.toEqual(usage);
		await expect(gateway.readGlobalBudget(controller.signal)).resolves.toEqual(globalBudget);
		await expect(gateway.readAccountBudgets(controller.signal)).resolves.toEqual(accounts);

		const requests = fetch.mock.calls.map(call => call[0] as Request);
		expect(requests.map(request => request.url)).toEqual(["https://opencrane.test/api/v1/audit?limit=5&cursor=opaque_cursor", "https://opencrane.test/api/v1/token-usage", "https://opencrane.test/api/v1/ai-budget/global", "https://opencrane.test/api/v1/ai-budget/accounts"]);
		for (const request of requests)
		{
			expect(request.method).toBe("GET");
			expect(request.credentials).toBe("include");
			expect(request.body).toBeNull();
			expect(request.signal.aborted).toBe(false);
		}
		controller.abort();
		expect(requests.every(request => request.signal.aborted)).toBe(true);
	});

	it("preserves filtered empty lists and an omitted usage ceiling", async function _EmptyAndOmitted()
	{
		const usage = [{ userId: "account-1", inputTokens: 1, outputTokens: 2, totalTokens: 3, currency: "EUR", totalCost: 0 }];
		const fetch = vi.fn().mockResolvedValueOnce(_Json([])).mockResolvedValueOnce(_Json(usage)).mockResolvedValueOnce(_Json([]));
		const gateway = _Gateway(fetch);
		await expect(gateway.readTokenUsage()).resolves.toEqual([]);
		const result = await gateway.readTokenUsage();
		expect(result[0]).not.toHaveProperty("budgetCeiling");
		await expect(gateway.readAccountBudgets()).resolves.toEqual([]);
	});

	it.each([[401, GovernanceReadErrorKinds.Unauthenticated], [403, GovernanceReadErrorKinds.AccessDenied], [500, GovernanceReadErrorKinds.Unavailable], [503, GovernanceReadErrorKinds.Unavailable], [400, GovernanceReadErrorKinds.InvalidResponse]] as const)("classifies status %s without requiring typed middleware error JSON", async function _UntypedError(status, kind)
	{
		const fetch = vi.fn().mockResolvedValue(new Response("private upstream response must not escape", { status }));
		const gateway = _Gateway(fetch);
		await expect(gateway.readGlobalBudget()).rejects.toMatchObject({ kind, message: new GovernanceReadError(kind).message });
	});

	it("classifies JSON middleware errors by status without retaining their fields", async function _MiddlewareBody()
	{
		const gateway = _Gateway(vi.fn().mockResolvedValue(_Json({ error: "OIDC session required", private: "hidden" }, 401)));
		const error = await gateway.readTokenUsage().catch(function _Failure(value: unknown) { return value; });
		expect(error).toBeInstanceOf(GovernanceReadError);
		expect(error).toMatchObject({ kind: GovernanceReadErrorKinds.Unauthenticated });
		expect(JSON.stringify(error)).not.toContain("hidden");
	});

	it.each([null, { currency: "USD" }, { currency: "USD", ceilingAmount: null }, { currency: "USD", ceilingAmount: 0, secret: "hidden" }])("rejects malformed successful budget bodies %#", async function _MalformedBody(body)
	{
		const gateway = _Gateway(vi.fn().mockResolvedValue(_Json(body)));
		await expect(gateway.readGlobalBudget()).rejects.toMatchObject({ kind: GovernanceReadErrorKinds.InvalidResponse });
	});

	it("rejects malformed JSON returned by the actual generated parser", async function _MalformedJson()
	{
		const gateway = _Gateway(vi.fn().mockResolvedValue(new Response("{private:broken", { status: 200, headers: { "Content-Type": "application/json" } })));
		await expect(gateway.readTokenUsage()).rejects.toMatchObject({ kind: GovernanceReadErrorKinds.InvalidResponse });
	});

	it("rejects a successful response without a body", async function _MissingBody()
	{
		const gateway = _Gateway(vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
		await expect(gateway.readAccountBudgets()).rejects.toMatchObject({ kind: GovernanceReadErrorKinds.InvalidResponse });
	});

	it("reduces network failures to static copy without retaining their cause", async function _NetworkFailure()
	{
		const gateway = _Gateway(vi.fn().mockRejectedValue(new TypeError("private URL or credential")));
		const error = await gateway.readAuditPage({}).catch(function _Failure(value: unknown) { return value; });
		expect(error).toMatchObject({ kind: GovernanceReadErrorKinds.Unavailable, message: new GovernanceReadError(GovernanceReadErrorKinds.Unavailable).message });
		expect(error).not.toHaveProperty("cause");
	});

	it("does not issue a request when its signal is already aborted", async function _AlreadyAborted()
	{
		const fetch = vi.fn();
		const gateway = _Gateway(fetch);
		const controller = new AbortController();
		controller.abort("private cancellation reason");
		await expect(gateway.readAuditPage({}, controller.signal)).rejects.toMatchObject({ name: "AbortError", message: "Governance read cancelled." });
		expect(fetch).not.toHaveBeenCalled();
	});

	it("does not publish a late successful result when transport ignores cancellation", async function _LateAbortedResult()
	{
		let resolve!: (response: Response) => void;
		const response = new Promise<Response>(function _Pending(complete) { resolve = complete; });
		const gateway = _Gateway(vi.fn().mockReturnValue(response));
		const controller = new AbortController();
		const pending = gateway.readGlobalBudget(controller.signal);
		controller.abort();
		resolve(_Json({ currency: "USD", ceilingAmount: 99 }));
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
	});
});
