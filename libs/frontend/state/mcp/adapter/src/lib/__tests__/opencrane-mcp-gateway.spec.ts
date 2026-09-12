import { Injector, runInInjectionContext } from "@angular/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONTROL_PLANE_BASE_URL, ControlPlaneApiService, McpConnectionStatus, McpCredentialRequirement } from "@opencrane/core";

import { OpenCraneMcpGateway } from "../opencrane-mcp-gateway";

const _ORIGIN = "https://control.example";

/** Build the live adapter over the real generated client while fetch remains test-controlled. */
function _Gateway(): OpenCraneMcpGateway
{
	const injector = Injector.create({
		providers: [
			{ provide: CONTROL_PLANE_BASE_URL, useValue: _ORIGIN },
			ControlPlaneApiService,
			OpenCraneMcpGateway,
		],
	});
	return runInInjectionContext(injector, function _Resolve(): OpenCraneMcpGateway
	{
		return injector.get(OpenCraneMcpGateway);
	});
}

/** Return a JSON response accepted by the generated fetch client. */
function _Json(body: unknown, status = 200): Response
{
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("OpenCraneMcpGateway", () =>
{
	afterEach(() => vi.unstubAllGlobals());

	it("rejects a catalogue response that omits credentialRequirement", async () =>
	{
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(_Json([{ id: "unsafe-default", tools: [] }])));

		await expect(_Gateway().listEntitledCatalogue()).rejects.toThrow("MCP credential requirement is invalid.");
	});

	it("uses generated bodies and encoded path parameters for install, governance, and uninstall", async () =>
	{
		const requests: Request[] = [];
		const fetch = vi.fn(async function _Fetch(request: Request): Promise<Response>
		{
			requests.push(request.clone());
			if (requests.length === 1)
				return _Json({ serverId: "alpha/tool ?", connectionStatus: "credentialless" }, 201);
			if (requests.length === 2)
				return _Json({ id: "alpha/tool ?", credentialRequirement: "credentialless", tools: [] });
			return new Response(null, { status: 204 });
		});
		vi.stubGlobal("fetch", fetch);
		const gateway = _Gateway();

		const installed = await gateway.install("alpha/tool ?");
		const approved = await gateway.approve("alpha/tool ?");
		await gateway.uninstall("alpha/tool ?");

		expect(installed.connectionStatus).toBe(McpConnectionStatus.Credentialless);
		expect(approved.credentialRequirement).toBe(McpCredentialRequirement.Credentialless);
		expect(requests.map(request => `${request.method} ${request.url}`)).toEqual([
			`POST ${_ORIGIN}/api/v1/mcp/installed`,
			`POST ${_ORIGIN}/api/v1/mcp/servers/alpha%2Ftool%20%3F/approve`,
			`DELETE ${_ORIGIN}/api/v1/mcp/installed/alpha%2Ftool%20%3F`,
		]);
		expect(await requests[0]?.json()).toEqual({ serverId: "alpha/tool ?" });
	});

	it("rejects a non-success response without adopting its body", async () =>
	{
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(_Json({ error: "private detail", code: "DENIED" }, 403)));

		await expect(_Gateway().install("denied")).rejects.toThrow("The MCP server could not be installed.");
	});
});
