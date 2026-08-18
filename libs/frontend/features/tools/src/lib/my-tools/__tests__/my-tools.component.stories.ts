import { provideRouter } from "@angular/router";
import { applicationConfig } from "@storybook/angular";
import type { Meta, StoryObj } from "@storybook/angular";

import { McpApprovalStatus, McpConnectionStatus, McpInstalledServer } from "@opencrane/core";
import { MCP_CATALOGUE, MCP_INSTALLED } from "@opencrane/core/testing";
import { MCP_GATEWAY, McpGateway } from "@opencrane/state/mcp/adapter";

import { MyToolsComponent } from "../my-tools.component";

/** Creates an isolated gateway that preserves connection changes after each reload. */
function _CreateMyToolsGateway(): Pick<McpGateway, "listEntitledCatalogue" | "listInstalled" | "uninstall" | "setCredential" | "removeCredential" | "connectOauth" | "disconnect">
{
	const installed = new Map<string, McpInstalledServer>(MCP_INSTALLED.map(function byServer(record: McpInstalledServer): [string, McpInstalledServer] { return [record.serverId, { ...record }]; }));

	/** Updates the requested server and returns the same state that the next read will expose. */
	function _SetConnection(serverId: string, connectionStatus: McpConnectionStatus, connectedAccount?: string): McpInstalledServer
	{
		const current = installed.get(serverId);
		if (!current) throw new Error(`Unknown installed MCP server: ${serverId}`);
		const updated: McpInstalledServer = { ...current, connectionStatus, connectedAccount };
		installed.set(serverId, updated);
		return { ...updated };
	}

	return {
		listEntitledCatalogue: function listEntitledCatalogue() { return Promise.resolve(MCP_CATALOGUE.filter(function published(server) { return server.approvalStatus === McpApprovalStatus.Published; }).map(function clone(server) { return { ...server }; })); },
		listInstalled: function listInstalled() { return Promise.resolve(Array.from(installed.values(), function clone(record) { return { ...record }; })); },
		uninstall: function uninstall(serverId: string) { installed.delete(serverId); return Promise.resolve(); },
		setCredential: function setCredential(serverId: string) { return Promise.resolve(_SetConnection(serverId, McpConnectionStatus.Connected)); },
		removeCredential: function removeCredential(serverId: string) { return Promise.resolve(_SetConnection(serverId, McpConnectionStatus.NeedsCredential)); },
		connectOauth: function connectOauth(serverId: string) { return Promise.resolve(_SetConnection(serverId, McpConnectionStatus.OauthConnected, "storybook@example.com")); },
		disconnect: function disconnect(serverId: string) { return Promise.resolve(_SetConnection(serverId, McpConnectionStatus.NeedsCredential)); }
	};
}

const meta: Meta<MyToolsComponent> = {
	title: "Tools/My tools",
	component: MyToolsComponent,
	tags: ["autodocs"],
	decorators: [applicationConfig({ providers: [provideRouter([]), { provide: MCP_GATEWAY, useFactory: _CreateMyToolsGateway }] })],
	parameters: {
		docs: {
			description: {
				component: "The participant-facing inventory of installed MCP servers. The story uses shared fixture data so representative connection states remain reviewable without a live control plane."
			}
		}
	}
};

export default meta;
type Story = StoryObj<MyToolsComponent>;

/** Installed tools cover pending credentials, OAuth, token, shared-key, and activation states. */
export const InstalledStates: Story = {
	parameters: { docs: { description: { story: "The default fixture shows the status table, the pending-credential callout, and the catalogue navigation affordance." } } }
};
