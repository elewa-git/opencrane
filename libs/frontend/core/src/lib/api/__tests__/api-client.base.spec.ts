import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenCraneApiClientBase } from "../api-client.base";
import { OpenCraneApiError } from "../api-error";

/** Concrete client exposing the shared raw-request path for transport tests. */
class _TestApiClient extends OpenCraneApiClientBase<Record<string, never>>
{
	/** Bind the client to a stable test origin. */
	public constructor()
	{
		super("https://control.example.test");
	}

	/** Exercises the generated openapi-fetch middleware without requiring a generated path. */
	public async protectedRead(signal: AbortSignal): Promise<unknown>
	{
		const client = this.client as unknown as { GET(path: string, options: { signal: AbortSignal }): Promise<unknown> };
		return client.GET("/protected", { signal });
	}
}

function _StubBrowserRedirect(): ReturnType<typeof vi.fn>
{
	const assign = vi.fn();
	vi.stubGlobal("window", { location: { assign } });
	return assign;
}

describe("OpenCraneApiClientBase.request", function _Suite()
{
	afterEach(function _RestoreFetch()
	{
		vi.unstubAllGlobals();
	});

	it("throws a typed frontend error with server-authored validation paths", async function _TypedValidationFailure()
	{
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
			error: "Request validation failed.",
			code: "VALIDATION_ERROR",
			issues: [{ location: "body", path: ["autoConfig", "objective"], message: "This field has an unsupported value." }],
			detail: "must not become the browser error message",
		}), { status: 400, headers: { "Content-Type": "application/json" } })));
		const client = new _TestApiClient();

		const failure = await client.request("PUT", "/model-routing/defaults", { body: {} }).catch(function _Capture(error: unknown): unknown { return error; });

		expect(failure).toBeInstanceOf(OpenCraneApiError);
		expect(failure).toMatchObject({
			message: "Request validation failed.",
			status: 400,
			code: "VALIDATION_ERROR",
			issues: [{ location: "body", path: ["autoConfig", "objective"] }],
		});
	});

	it("uses a fixed typed fallback when an error body is not a public envelope", async function _FallbackFailure()
	{
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream secret", { status: 502 })));
		const client = new _TestApiClient();

		const failure = await client.request("POST", "/unknown").catch(function _Capture(error: unknown): unknown { return error; });

		expect(failure).toMatchObject({ status: 502, code: "HTTP_ERROR", issues: [] });
		expect((failure as Error).message).not.toContain("upstream secret");
	});

	it("keeps an ordinary current 401 on the sign-in path", async function _CurrentUnauthorized()
	{
		const assign = _StubBrowserRedirect();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));
		const client = new _TestApiClient();

		await client.protectedRead(new AbortController().signal);

		expect(assign).toHaveBeenCalledOnce();
	});

	it("does not redirect after the request has been aborted", async function _AbortedUnauthorized()
	{
		const assign = _StubBrowserRedirect();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));
		const client = new _TestApiClient();
		const controller = new AbortController();
		controller.abort();

		await client.protectedRead(controller.signal);

		expect(assign).not.toHaveBeenCalled();
	});

	it("passes the abort coordinate to the direct request path", async function _DirectRequestAbort()
	{
		const assign = _StubBrowserRedirect();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));
		const client = new _TestApiClient();
		const controller = new AbortController();
		controller.abort();

		await expect(client.request("GET", "/protected", { signal: controller.signal })).rejects.toBeInstanceOf(OpenCraneApiError);

		expect(assign).not.toHaveBeenCalled();
	});
});

describe("OpenCraneApiClientBase registration URL", function _RegistrationUrlSuite()
{
	it("adds the provider registration prompt and preserves the invitation return path", function _RegistrationUrl()
	{
		const client = new _TestApiClient();

		expect(client.signUpUrl("/invite?token=opaque-signed-token")).toBe("https://control.example.test/api/v1/auth/login?prompt=create&returnTo=%2Finvite%3Ftoken%3Dopaque-signed-token");
	});
});
