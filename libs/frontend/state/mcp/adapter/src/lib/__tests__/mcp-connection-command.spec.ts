import { Injector, runInInjectionContext } from "@angular/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONTROL_PLANE_BASE_URL, ControlPlaneApiService, McpConnectionStatus } from "@opencrane/core";

import { McpConnectionCommandError } from "../mcp-connection-command.error";
import { McpConnectionCommandFailureKinds, type McpConnectionCommand } from "../mcp-gateway.types";
import { OpenCraneMcpGateway } from "../opencrane-mcp-gateway";

/** Use the generated client with test-controlled fetch; no external request is made. */
function _Gateway(): OpenCraneMcpGateway
{
	const injector = Injector.create({ providers: [{ provide: CONTROL_PLANE_BASE_URL, useValue: "https://control.example" }, ControlPlaneApiService, OpenCraneMcpGateway] });
	return runInInjectionContext(injector, function _Resolve() { return injector.get(OpenCraneMcpGateway); });
}

/** A safe server response contains no submitted material or custody coordinates. */
function _Projection()
{
	return { connectionStatus: McpConnectionStatus.Activating, connectionGeneration: 2, credentialUpdatedAt: null, failureCode: null };
}

/** Synthetic material exists only inside these transport tests. */
function _Command(): McpConnectionCommand
{
	return { idempotencyKey: "synthetic-command-identity", expectedGeneration: 1, credential: { kind: "bearer", token: " synthetic-token-with-spaces " } };
}

/** Return a JSON response without contacting the named origin. */
function _Response(body: unknown, status = 202): Response
{
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("personal MCP connection commands through the generated client", function _Suite()
{
	afterEach(function _Restore() { vi.unstubAllGlobals(); });

	it("encodes the server path, preserves write-only material, and sends revoke identity as a query", async function _WireCommands()
	{
		const requests: Request[] = [];
		vi.stubGlobal("fetch", vi.fn(async function _Fetch(request: Request)
		{
			requests.push(request.clone());
			return _Response(_Projection());
		}));
		const gateway = _Gateway();
		const command = _Command();
		await expect(gateway.activatePersonalConnection("alpha/tool ?", command)).resolves.toEqual(_Projection());
		await expect(gateway.revokePersonalConnection("alpha/tool ?", "retry key/?", 2)).resolves.toEqual(_Projection());

		expect(requests[0].method).toBe("PUT");
		expect(requests[0].url).toBe("https://control.example/api/v1/mcp/installed/alpha%2Ftool%20%3F/connection");
		expect(await requests[0].json()).toEqual(command);
		expect(requests[1].method).toBe("DELETE");
		expect(new URL(requests[1].url).searchParams.get("commandId")).toBe("retry key/?");
		expect(new URL(requests[1].url).searchParams.get("expectedGeneration")).toBe("2");
		expect(await requests[1].text()).toBe("");
	});

	it("sends an explicit credentialless command without creating a token field", async function _Credentialless()
	{
		const fetch = vi.fn().mockResolvedValue(_Response(_Projection()));
		vi.stubGlobal("fetch", fetch);
		await _Gateway().activatePersonalConnection("public", { idempotencyKey: "public-command", expectedGeneration: null, credential: { kind: "none" } });
		expect(await (fetch.mock.calls[0][0] as Request).json()).toEqual({ idempotencyKey: "public-command", expectedGeneration: null, credential: { kind: "none" } });
	});

	it.each([
		[400, McpConnectionCommandFailureKinds.Rejected],
		[401, McpConnectionCommandFailureKinds.AccessChanged],
		[403, McpConnectionCommandFailureKinds.AccessChanged],
		[404, McpConnectionCommandFailureKinds.Unavailable],
		[409, McpConnectionCommandFailureKinds.Conflict],
		[429, McpConnectionCommandFailureKinds.Uncertain],
		[500, McpConnectionCommandFailureKinds.Uncertain],
	])("classifies HTTP %s without exposing the response body", async function _Failure(status, kind)
	{
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(_Response({ message: "synthetic-sensitive-provider-detail" }, status)));
		try
		{
			await _Gateway().activatePersonalConnection("private", _Command());
			throw new Error("Expected the command to fail");
		}
		catch (error)
		{
			expect(error).toBeInstanceOf(McpConnectionCommandError);
			expect(error).toMatchObject({ kind });
			expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain("synthetic-sensitive-provider-detail");
			expect(error).not.toHaveProperty("cause");
		}
	});

	it.each([
		{ ..._Projection(), connectionGeneration: 0 },
		{ ..._Projection(), connectionGeneration: Number.MAX_SAFE_INTEGER + 1 },
		{ ..._Projection(), connectionStatus: "surprise" },
		{ ..._Projection(), credentialUpdatedAt: "not-a-date" },
		{ ..._Projection(), failureCode: "private-error" },
		{ ..._Projection(), token: "synthetic-response-token" },
		{ connectionStatus: McpConnectionStatus.Active },
	])("treats a malformed success as uncertain without adopting its data", async function _InvalidSuccess(body)
	{
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(_Response(body)));
		await expect(_Gateway().activatePersonalConnection("private", _Command())).rejects.toMatchObject({ kind: McpConnectionCommandFailureKinds.Uncertain });
	});

	it("does not retain a network exception or replace the caller's retry command", async function _LostResponse()
	{
		const fetch = vi.fn().mockRejectedValueOnce(new Error("synthetic-private-network-detail")).mockResolvedValueOnce(_Response(_Projection()));
		vi.stubGlobal("fetch", fetch);
		const command = _Command();
		const gateway = _Gateway();
		await expect(gateway.activatePersonalConnection("private", command)).rejects.toMatchObject({ kind: McpConnectionCommandFailureKinds.Uncertain });
		await expect(gateway.activatePersonalConnection("private", command)).resolves.toEqual(_Projection());
		expect(await (fetch.mock.calls[0][0] as Request).json()).toEqual(await (fetch.mock.calls[1][0] as Request).json());
	});

	it("retains uncertainty when revoke returns invalid JSON", async function _InvalidJson()
	{
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 202, headers: { "Content-Type": "application/json" } })));
		await expect(_Gateway().revokePersonalConnection("private", "revoke-command", 2)).rejects.toMatchObject({ kind: McpConnectionCommandFailureKinds.Uncertain });
	});

	it.each([401, 403])("reports access loss on refresh even when HTTP %s has a non-JSON body", async function _ReadAccessLoss(status)
	{
		vi.stubGlobal("fetch", vi.fn().mockImplementation(function _Denied() { return Promise.resolve(new Response("private response detail", { status })); }));
		const gateway = _Gateway();
		await expect(gateway.listInstalled()).rejects.toMatchObject({ kind: McpConnectionCommandFailureKinds.AccessChanged });
		await expect(gateway.listEntitledCatalogue()).rejects.toMatchObject({ kind: McpConnectionCommandFailureKinds.AccessChanged });
	});
});
