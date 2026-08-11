import { describe, expect, it } from "vitest";

import { __UnavailableObotCustodyAdapter, __UnavailableObotMcpInvocationAdapter, ObotCustodyUnavailableError, ObotMcpInvocationUnavailableError } from "@opencrane/backend/server/infra/obot-custody";

import { _CreateObotAdapters } from "../obot-adapters.factory.js";

describe("OpenCrane Obot adapter composition", function _ObotAdaptersSuite()
{
	it("composes fail-closed custody and invocation adapters when Obot is disabled", async function _UnavailableAdapters()
	{
		const adapters = _CreateObotAdapters(null);
		await expect(adapters.custody.revoke("custody-1")).rejects.toBeInstanceOf(ObotCustodyUnavailableError);
		await expect(adapters.invocation.invokeTool({ siloId: "silo-1", integrationId: "calendar", obotCustodyReference: "custody-1", toolName: "calendar.read", arguments: {}, allowedToolNames: ["calendar.read"] })).rejects.toBeInstanceOf(ObotMcpInvocationUnavailableError);
	});

	it("validates configured Obot addressing while composing both real adapters", function _ConfiguredAdapters()
	{
		expect(function _ExternalOrigin()
		{
			_CreateObotAdapters({ gatewayUrl: "http://attacker.example:8080", serviceTokenPath: "/var/run/opencrane/obot/token", requestTimeoutMilliseconds: 30_000 });
		}).toThrow(/OBOT_GATEWAY_URL/);

		const adapters = _CreateObotAdapters({ gatewayUrl: "http://oc-mcp-gateway.silo.svc.cluster.local:8080", serviceTokenPath: "/var/run/opencrane/obot/token", requestTimeoutMilliseconds: 30_000 });
		expect(adapters.custody).not.toBeInstanceOf(__UnavailableObotCustodyAdapter);
		expect(adapters.invocation).not.toBeInstanceOf(__UnavailableObotMcpInvocationAdapter);
	});
});
