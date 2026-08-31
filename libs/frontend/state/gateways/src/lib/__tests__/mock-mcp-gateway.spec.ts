import { describe, expect, it } from "vitest";

import { McpApprovalStatus, McpConnectionStatus, McpServerType } from "@opencrane/core";

import { MockMcpGateway } from "../__test__/mock-mcp-gateway";

describe("MockMcpGateway", () =>
{
	it("returns only published servers from the entitled catalogue", async () =>
	{
		const gateway = new MockMcpGateway();
		const catalogue = await gateway.listEntitledCatalogue();

		expect(catalogue.length).toBeGreaterThan(0);
		expect(catalogue.every(function isPublished(server): boolean { return server.approvalStatus === "published"; })).toBe(true);
		expect(catalogue.some(function isPending(server): boolean { return server.id === "linear"; })).toBe(false);
	});

	it("seeds installed servers covering each connection state", async () =>
	{
		const gateway = new MockMcpGateway();
		const installed = await gateway.listInstalled();

		const stripe = installed.find(function byId(record): boolean { return record.serverId === "stripe"; });
		expect(stripe?.connectionStatus).toBe(McpConnectionStatus.NeedsCredential);
	});

	it("installs a single-user server as needing a credential", async () =>
	{
		const gateway = new MockMcpGateway();
		await gateway.uninstall("stripe");

		const record = await gateway.install("stripe");
		expect(record.connectionStatus).toBe(McpConnectionStatus.NeedsCredential);
	});

	it("installs a multi-user server ready via the admin shared key", async () =>
	{
		const gateway = new MockMcpGateway();
		await gateway.uninstall("postgres-prod");

		const record = await gateway.install("postgres-prod");
		expect(record.connectionStatus).toBe(McpConnectionStatus.SharedKey);
	});

	it("uninstalls a server so it drops off the installed list", async () =>
	{
		const gateway = new MockMcpGateway();
		await gateway.uninstall("notion");

		const installed = await gateway.listInstalled();
		expect(installed.some(function byId(record): boolean { return record.serverId === "notion"; })).toBe(false);
	});

	it("throws when installing an unknown server", async () =>
	{
		const gateway = new MockMcpGateway();
		await expect(gateway.install("does-not-exist")).rejects.toThrow(/unknown MCP server/);
	});

	it("exposes single-user credential schema fields on the catalogue", async () =>
	{
		const gateway = new MockMcpGateway();
		const catalogue = await gateway.listEntitledCatalogue();
		const stripe = catalogue.find(function byId(server): boolean { return server.id === "stripe"; });

		expect(stripe?.type).toBe(McpServerType.SingleUser);
		expect(stripe?.credentialSchema.some(function isSensitive(field): boolean { return field.sensitive; })).toBe(true);
	});

	it("includes pending + disabled servers in the admin catalogue but not the entitled one", async () =>
	{
		const gateway = new MockMcpGateway();
		const adminIds = (await gateway.listCatalogue()).map(function id(server): string { return server.id; });
		const entitledIds = (await gateway.listEntitledCatalogue()).map(function id(server): string { return server.id; });

		expect(adminIds).toContain("linear");
		expect(adminIds).toContain("sentry");
		expect(entitledIds).not.toContain("linear");
		expect(entitledIds).not.toContain("sentry");
	});

	it("approves then publishes a pending server, surfacing it to the entitled catalogue", async () =>
	{
		const gateway = new MockMcpGateway();

		const approved = await gateway.approve("linear");
		expect(approved.approvalStatus).toBe(McpApprovalStatus.Approved);

		const published = await gateway.publish("linear");
		expect(published.approvalStatus).toBe(McpApprovalStatus.Published);

		const entitledIds = (await gateway.listEntitledCatalogue()).map(function id(server): string { return server.id; });
		expect(entitledIds).toContain("linear");
	});

	it("disables and re-enables a published server", async () =>
	{
		const gateway = new MockMcpGateway();

		const disabled = await gateway.setEnabled("github", false);
		expect(disabled.approvalStatus).toBe(McpApprovalStatus.Disabled);

		const reenabled = await gateway.setEnabled("github", true);
		expect(reenabled.approvalStatus).toBe(McpApprovalStatus.Published);
	});

});
