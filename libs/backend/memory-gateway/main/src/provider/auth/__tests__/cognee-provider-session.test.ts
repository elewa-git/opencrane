import { describe, expect, it, vi } from "vitest";

import { CogneeProviderSessionError } from "../cognee-provider-session-error";
import { _CreateCogneeProviderSession } from "../cognee-provider-session";
import { CogneeProviderSessionFailureCodes, type CogneeProviderCredentialReader, type CogneeProviderSessionOptions } from "../cognee-provider-session.types";
import type { CogneeProviderFetch } from "../../http/cognee-provider-http.types";

const _EMAIL = "memory-gateway@example.com";
const _PASSWORD = "synthetic-password";

function _Credentials(): CogneeProviderCredentialReader
{
	return { async read() { return { email: _EMAIL, password: _PASSWORD }; } };
}

function _Options(fetch: CogneeProviderFetch, changes: Partial<CogneeProviderSessionOptions> = {}): CogneeProviderSessionOptions
{
	return {
		baseUrl: "http://cognee:8000",
		credentialReader: _Credentials(),
		requestTimeoutMilliseconds: 100,
		maximumResponseBytes: 4_096,
		allowFirstInstallRegistration: false,
		fetch,
		...changes,
	};
}

function _Login(token: string): Response
{
	return Response.json({ access_token: token, token_type: "bearer" });
}

function _Path(input: string | URL | Request): string
{
	return new URL(input instanceof Request ? input.url : input).pathname;
}

function _Authorization(init: RequestInit | undefined): string | null
{
	return new Headers(init?.headers).get("authorization");
}

describe("Cognee provider session", function _CogneeProviderSessionTests()
{
	it("uses the exact form login and retains the bearer only inside the session", async function _LoginContract()
	{
		const requests: Array<{ path: string; init: RequestInit | undefined }> = [];
		const fetchMock = vi.fn(async function _Fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
		{
			requests.push({ path: _Path(input), init });
			return _Login("private-bearer");
		});
		const session = _CreateCogneeProviderSession(_Options(fetchMock));

		await Promise.all([session.ensureReady(), session.ensureReady()]);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(requests[0]?.path).toBe("/api/v1/auth/login");
		expect(requests[0]?.init).toMatchObject({ method: "POST", redirect: "error" });
		expect(new Headers(requests[0]?.init?.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
		expect(requests[0]?.init?.body).toBe("username=memory-gateway%40example.com&password=synthetic-password");
		expect(_Authorization(requests[0]?.init)).toBeNull();
		expect(session).not.toHaveProperty("bearerToken");
	});

	it("performs the enabled first-install login, registration, and second login once", async function _Registration()
	{
		const calls: Array<{ path: string; body: BodyInit | null | undefined }> = [];
		const fetchMock = vi.fn(async function _Fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
		{
			const path = _Path(input);
			calls.push({ path, body: init?.body });
			if (calls.length === 1)
				return new Response("existing lookup absent", { status: 400 });
			if (calls.length === 2)
				return new Response("created", { status: 201 });
			return _Login("registered-bearer");
		});
		const session = _CreateCogneeProviderSession(_Options(fetchMock, { allowFirstInstallRegistration: true }));

		await session.ensureReady();
		await session.ensureReady();

		expect(calls.map(function _CallPath(call) { return call.path; })).toEqual([
			"/api/v1/auth/login",
			"/api/v1/auth/register",
			"/api/v1/auth/login",
		]);
		expect(calls[1]?.body).toBe(JSON.stringify({ email: _EMAIL, password: _PASSWORD }));
	});

	it("does not replace an existing account or repeat registration after wrong credentials", async function _WrongPassword()
	{
		const paths: string[] = [];
		const fetchMock = vi.fn(async function _Fetch(input: string | URL | Request): Promise<Response>
		{
			const path = _Path(input);
			paths.push(path);
			return new Response(path.endsWith("register") ? "provider says existing secret token-x" : "bad synthetic-password", { status: 400 });
		});
		const session = _CreateCogneeProviderSession(_Options(fetchMock, { allowFirstInstallRegistration: true }));

		const first = await session.ensureReady().catch(function _Failure(error: unknown) { return error; });
		const second = await session.ensureReady().catch(function _Failure(error: unknown) { return error; });

		expect(paths).toEqual(["/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/login"]);
		expect(first).toMatchObject({ code: CogneeProviderSessionFailureCodes.RegistrationRejected });
		expect(second).toMatchObject({ code: CogneeProviderSessionFailureCodes.AuthenticationRejected });
		expect(String(first)).not.toContain(_PASSWORD);
		expect(String(first)).not.toContain("token-x");
		expect(String(second)).not.toContain(_PASSWORD);
	});

	it("shares one refresh across concurrent HTTP 401 responses", async function _ConcurrentRefresh()
	{
		let loginCount = 0;
		let oldRequests = 0;
		let releaseOldResponses: (() => void) | undefined;
		const oldResponsesReady = new Promise<void>(function _Wait(resolve) { releaseOldResponses = resolve; });
		const fetchMock = vi.fn(async function _Fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
		{
			if (_Path(input).endsWith("/login"))
			{
				loginCount += 1;
				return _Login(loginCount === 1 ? "old-token" : "new-token");
			}
			if (_Authorization(init) === "Bearer old-token")
			{
				oldRequests += 1;
				if (oldRequests === 2)
					releaseOldResponses?.();
				await oldResponsesReady;
				return new Response("unauthorized", { status: 401 });
			}
			return new Response("accepted", { status: 200 });
		});
		const session = _CreateCogneeProviderSession(_Options(fetchMock));

		const command = { method: "POST", path: "/api/v1/add", headers: { "content-type": "application/json" }, body: "same-command" };
		const results = await Promise.all([session.exchange(command), session.exchange(command)]);

		expect(loginCount).toBe(2);
		expect(oldRequests).toBe(2);
		expect(results.map(function _Status(response) { return response.status; })).toEqual([200, 200]);
		const effectCalls = fetchMock.mock.calls.filter(function _Effect(call) { return _Path(call[0]) === "/api/v1/add"; });
		expect(effectCalls).toHaveLength(4);
		expect(effectCalls.map(function _Body(call) { return call[1]?.body; })).toEqual(["same-command", "same-command", "same-command", "same-command"]);
	});

	it("uses a newer session when an older HTTP 401 arrives late", async function _StaleUnauthorized()
	{
		let loginCount = 0;
		let oldCallCount = 0;
		let reportSlowStarted: (() => void) | undefined;
		const slowStarted = new Promise<void>(function _Wait(resolve) { reportSlowStarted = resolve; });
		let releaseSlow: (() => void) | undefined;
		const slowResponse = new Promise<void>(function _Wait(resolve) { releaseSlow = resolve; });
		const fetchMock = vi.fn(async function _Fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
		{
			if (_Path(input).endsWith("/login"))
			{
				loginCount += 1;
				return _Login(loginCount === 1 ? "old-token" : "new-token");
			}
			if (_Authorization(init) === "Bearer old-token")
			{
				oldCallCount += 1;
				if (oldCallCount === 1)
				{
					reportSlowStarted?.();
					await slowResponse;
				}
				return new Response("unauthorized", { status: 401 });
			}
			return new Response("accepted", { status: 200 });
		});
		const session = _CreateCogneeProviderSession(_Options(fetchMock));
		await session.ensureReady();

		const slow = session.exchange({ method: "GET", path: "/api/v1/datasets" });
		await slowStarted;
		const fast = await session.exchange({ method: "GET", path: "/api/v1/datasets" });
		releaseSlow?.();
		const late = await slow;

		expect([fast.status, late.status]).toEqual([200, 200]);
		expect(loginCount).toBe(2);
	});

	it("replays at most once and drops only the rejected current session", async function _OneReplay()
	{
		let loginCount = 0;
		let effectCount = 0;
		const fetchMock = vi.fn(async function _Fetch(input: string | URL | Request): Promise<Response>
		{
			if (_Path(input).endsWith("/login"))
			{
				loginCount += 1;
				return _Login(`token-${loginCount}`);
			}
			effectCount += 1;
			return new Response("unauthorized", { status: 401 });
		});
		const session = _CreateCogneeProviderSession(_Options(fetchMock));

		await expect(session.exchange({ method: "POST", path: "/api/v1/add", body: "effect" })).rejects.toMatchObject({ code: CogneeProviderSessionFailureCodes.AuthenticationRejected });
		expect(effectCount).toBe(2);
		expect(loginCount).toBe(2);
		await session.ensureReady();
		expect(loginCount).toBe(3);
	});

	it("never replays a timed-out mutation", async function _Timeout()
	{
		let effectCount = 0;
		const fetchMock = vi.fn(async function _Fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
		{
			if (_Path(input).endsWith("/login"))
				return _Login("private-token");
			effectCount += 1;
			return new Promise<Response>(function _UntilAbort(_resolve, reject)
			{
				init?.signal?.addEventListener("abort", function _Abort() { reject(init.signal?.reason); }, { once: true });
			});
		});
		const session = _CreateCogneeProviderSession(_Options(fetchMock, { requestTimeoutMilliseconds: 5 }));

		await expect(session.exchange({ method: "POST", path: "/api/v1/add", body: "effect" })).rejects.toMatchObject({ code: CogneeProviderSessionFailureCodes.Timeout });
		expect(effectCount).toBe(1);
	});

	it("never replays a mutation after a network failure", async function _NetworkFailure()
	{
		let effectCount = 0;
		const fetchMock = vi.fn(async function _Fetch(input: string | URL | Request): Promise<Response>
		{
			if (_Path(input).endsWith("/login"))
				return _Login("private-token");
			effectCount += 1;
			throw new Error("provider disconnected after receiving private content");
		});
		const session = _CreateCogneeProviderSession(_Options(fetchMock));

		const error = await session.exchange({ method: "POST", path: "/api/v1/add", body: "private content" }).catch(function _Failure(failure: unknown) { return failure; });

		expect(error).toMatchObject({ code: CogneeProviderSessionFailureCodes.Network });
		expect(String(error)).not.toContain("private content");
		expect(effectCount).toBe(1);
	});

	it("returns a bounded non-auth response without changing its disposition", async function _Response()
	{
		const fetchMock = vi.fn(async function _Fetch(input: string | URL | Request): Promise<Response>
		{
			if (_Path(input).endsWith("/login"))
				return _Login("private-token");
			return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
		});
		const session = _CreateCogneeProviderSession(_Options(fetchMock));

		const response = await session.exchange({ method: "GET", path: "/api/v1/datasets/missing" });

		expect(response).toEqual({ status: 404, contentType: "text/plain", body: new TextEncoder().encode("not found") });
	});

	it("rejects malformed login JSON and response overflow without exposing provider data", async function _LoginBounds()
	{
		const malformedFetch = vi.fn(async function _Malformed(): Promise<Response>
		{
			return Response.json({ access_token: "secret-token", token_type: "bearer", unexpected: "private" });
		});
		const malformed = _CreateCogneeProviderSession(_Options(malformedFetch));
		const malformedError = await malformed.ensureReady().catch(function _Failure(error: unknown) { return error; });
		expect(malformedError).toMatchObject({ code: CogneeProviderSessionFailureCodes.MalformedResponse });
		expect(String(malformedError)).not.toContain("secret-token");
		expect(String(malformedError)).not.toContain("private");

		const oversizeFetch = vi.fn(async function _Oversize(): Promise<Response>
		{
			return new Response("secret-token", { status: 200, headers: { "content-length": "5000" } });
		});
		const oversize = _CreateCogneeProviderSession(_Options(oversizeFetch, { maximumResponseBytes: 10 }));
		const oversizeError = await oversize.ensureReady().catch(function _Failure(error: unknown) { return error; });
		expect(oversizeError).toMatchObject({ code: CogneeProviderSessionFailureCodes.ResponseTooLarge });
		expect(String(oversizeError)).not.toContain("secret-token");

		const unsafeTokenFetch = vi.fn(async function _UnsafeToken(): Promise<Response>
		{
			return Response.json({ access_token: "secret-token\nforwarded", token_type: "bearer" });
		});
		const unsafeToken = _CreateCogneeProviderSession(_Options(unsafeTokenFetch));
		await expect(unsafeToken.ensureReady()).rejects.toMatchObject({ code: CogneeProviderSessionFailureCodes.MalformedResponse });
	});

	it("turns credential reader failures into a fixed secret-free outcome", async function _CredentialFailure()
	{
		const credentialReader = {
			async read()
			{
				throw new Error("mounted synthetic-password could not be read");
			},
		};
		const fetchMock = vi.fn(async function _Unexpected(): Promise<Response> { throw new Error("unexpected fetch"); });
		const session = _CreateCogneeProviderSession(_Options(fetchMock, { credentialReader }));

		const error = await session.ensureReady().catch(function _Failure(failure: unknown) { return failure; });

		expect(error).toBeInstanceOf(CogneeProviderSessionError);
		expect(error).toMatchObject({ code: CogneeProviderSessionFailureCodes.CredentialsUnavailable });
		expect(String(error)).not.toContain(_PASSWORD);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects absolute paths and authentication overrides before reading credentials", async function _UnsafeRequest()
	{
		const read = vi.fn(async function _Read() { return { email: _EMAIL, password: _PASSWORD }; });
		const fetchMock = vi.fn(async function _Unexpected(): Promise<Response> { throw new Error("unexpected fetch"); });
		const session = _CreateCogneeProviderSession(_Options(fetchMock, { credentialReader: { read } }));

		await expect(session.exchange({ method: "GET", path: "https://other.example/api/v1/datasets" })).rejects.toMatchObject({ code: CogneeProviderSessionFailureCodes.UnsafeRequest });
		await expect(session.exchange({ method: "GET", path: "/api/v1/datasets", headers: { Authorization: "Bearer caller-token" } })).rejects.toMatchObject({ code: CogneeProviderSessionFailureCodes.UnsafeRequest });
		expect(read).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
