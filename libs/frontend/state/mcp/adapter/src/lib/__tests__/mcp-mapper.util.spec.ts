import { describe, expect, it } from "vitest";

import { McpApprovalStatus, McpConnectionStatus, McpCredentialRequirement, McpServerType } from "@opencrane/core";

import { _MapInstalled, _MapServer } from "../mcp-mapper.util";

describe("mcp-mapper.util", () =>
{
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
		const installed = _MapInstalled({ serverId: "stripe" } as never);
		const unknown = _MapInstalled({ serverId: "stripe", connectionStatus: "unexpected" } as never);

		expect(installed.connectionStatus).toBe(McpConnectionStatus.NeedsCredential);
		expect(installed.lastUsed).toBeNull();
		expect(unknown.connectionStatus).toBe(McpConnectionStatus.NeedsCredential);
	});

	it("preserves the credentialless connection status", () =>
	{
		const installed = _MapInstalled({ serverId: "public-weather", connectionStatus: "credentialless" });

		expect(installed.connectionStatus).toBe(McpConnectionStatus.Credentialless);
	});

});
