import { describe, expect, it } from "vitest";

import { McpApprovalStatus, McpConnectionStatus, McpInstallStates, McpCredentialRequirement, McpServerType } from "@opencrane/core";

import { _MapInstalled, _MapServer } from "../mcp-mapper.util";

describe("mcp-mapper.util", () =>
{
	it.each(Object.values(McpInstallStates))("preserves the saved %s installation lifecycle", function _SavedLifecycle(lifecycleState)
	{
		const installed = _MapInstalled({ serverId: "farm", lifecycleState, connectionStatus: "active", connectionGeneration: 1, credentialUpdatedAt: null, failureCode: null });
		expect(installed.lifecycleState).toBe(lifecycleState);
	});

	it("rejects missing or unknown installation lifecycle instead of re-enabling removal", function _RejectsUnknownLifecycle()
	{
		expect(function _Missing() { return _MapInstalled({ serverId: "farm" } as never); }).toThrow("MCP installation lifecycle is invalid.");
		expect(function _Unknown() { return _MapInstalled({ serverId: "farm", lifecycleState: "invented" } as never); }).toThrow("MCP installation lifecycle is invalid.");
	});

	it("maps a full wire server and coerces its enums", () =>
	{
		const server = _MapServer({ id: "github", name: "github", type: "remote-oauth", credentialRequirement: "principal-credential", approvalStatus: "published", tools: [] });

		expect(server.type).toBe(McpServerType.RemoteOauth);
		expect(server.credentialRequirement).toBe(McpCredentialRequirement.PrincipalCredential);
		expect(server.approvalStatus).toBe(McpApprovalStatus.Published);
		expect(server.credentialSchema).toEqual([]);
	});

	it("defaults unknown enum strings safely and derives a glyph", () =>
	{
		const server = _MapServer({ id: "acme-tool", type: "bogus", credentialRequirement: "shared-credential", approvalStatus: "nonsense", tools: [] } as never);

		expect(server.type).toBe(McpServerType.SingleUser);
		expect(server.approvalStatus).toBe(McpApprovalStatus.PendingReview);
		expect(server.name).toBe("acme-tool");
		expect(server.glyph).toBe("ac");
	});

	it.each(Object.values(McpCredentialRequirement))("preserves the %s credential requirement", requirement =>
	{
		const server = _MapServer({ id: "known-requirement", credentialRequirement: requirement, tools: [] });

		expect(server.credentialRequirement).toBe(requirement);
	});

	it("rejects a missing or unknown credential requirement", () =>
	{
		expect(() => _MapServer({ id: "missing-requirement" } as never)).toThrow("MCP credential requirement is invalid.");
		expect(() => _MapServer({ id: "unknown-requirement", credentialRequirement: "invented", tools: [] } as never)).toThrow("MCP credential requirement is invalid.");
	});

	it("maps an installed record and defaults missing or unknown status", () =>
	{
		const installed = _MapInstalled({ serverId: "stripe", lifecycleState: McpInstallStates.Installed } as never);
		const unknown = _MapInstalled({ serverId: "stripe", lifecycleState: McpInstallStates.Installed, connectionStatus: "unexpected", connectionGeneration: 0, credentialUpdatedAt: 3, failureCode: "invented" } as never);

		expect(installed.connectionStatus).toBe(McpConnectionStatus.NeedsCredential);
		expect(installed.connectionGeneration).toBeNull();
		expect(installed.lastUsed).toBeNull();
		expect(unknown.connectionStatus).toBe(McpConnectionStatus.NeedsCredential);
		expect(unknown.connectionGeneration).toBeNull();
		expect(unknown.credentialUpdatedAt).toBeNull();
		expect(unknown.failureCode).toBe("credential-unavailable");
	});

	it.each(Object.values(McpConnectionStatus))("preserves the %s connection status", connectionStatus =>
	{
		const installed = _MapInstalled({ serverId: "public-weather", lifecycleState: McpInstallStates.Installed, connectionStatus, connectionGeneration: 2, credentialUpdatedAt: "2026-09-12T12:00:00.000Z", failureCode: null });

		expect(installed.connectionStatus).toBe(connectionStatus);
		expect(installed.connectionGeneration).toBe(2);
		expect(installed.credentialUpdatedAt).toBe("2026-09-12T12:00:00.000Z");
		expect(installed.failureCode).toBeNull();
	});

});
