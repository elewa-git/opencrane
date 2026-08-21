import { describe, expect, it } from "vitest";

import { McpApprovalStatus, McpConnectionStatus, McpServerType } from "@opencrane/core";

import { _MapAccessPolicy, _MapDirectory, _MapInstalled, _MapServer } from "../mcp-mapper.util";

describe("mcp-mapper.util", () =>
{
	it("maps a full wire server and coerces its enums", () =>
	{
		const server = _MapServer({ id: "github", name: "github", type: "remote-oauth", approvalStatus: "published" });

		expect(server.type).toBe(McpServerType.RemoteOauth);
		expect(server.approvalStatus).toBe(McpApprovalStatus.Published);
		expect(server.credentialSchema).toEqual([]);
	});

	it("defaults unknown enum strings safely and derives a glyph", () =>
	{
		const server = _MapServer({ id: "acme-tool", type: "bogus", approvalStatus: "nonsense" });

		expect(server.type).toBe(McpServerType.SingleUser);
		expect(server.approvalStatus).toBe(McpApprovalStatus.PendingReview);
		expect(server.name).toBe("acme-tool");
		expect(server.glyph).toBe("ac");
	});

	it("maps an installed record and defaults a missing status / last-used", () =>
	{
		const installed = _MapInstalled({ serverId: "stripe" });

		expect(installed.connectionStatus).toBe(McpConnectionStatus.NeedsCredential);
		expect(installed.lastUsed).toBeNull();
	});

	it("preserves a known connection status", () =>
	{
		const installed = _MapInstalled({ serverId: "github", connectionStatus: "oauth-connected", connectedAccount: "x@y.com" });

		expect(installed.connectionStatus).toBe(McpConnectionStatus.OauthConnected);
		expect(installed.connectedAccount).toBe("x@y.com");
	});

	it("fills missing collections on a policy and a directory", () =>
	{
		const policy = _MapAccessPolicy({ serverId: "github" });
		expect(policy.groups).toEqual([]);
		expect(policy.users).toEqual([]);

		const directory = _MapDirectory({});
		expect(directory.users).toEqual([]);
		expect(directory.groups).toEqual([]);
	});
});
