import { provideRouter } from "@angular/router";
import { applicationConfig } from "@storybook/angular";
import type { Meta, StoryObj } from "@storybook/angular";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { McpApprovalStatus, McpConnectionStatus, McpInstalledServer, McpServerType } from "@opencrane/core";
import { MCP_CATALOGUE, MCP_INSTALLED } from "@opencrane/core/testing";
import { MCP_GATEWAY, McpGateway } from "@opencrane/state/mcp/adapter";

import { CatalogueComponent } from "../catalogue.component";

/** Creates an isolated catalogue gateway whose install results match each server type. */
function _CreateCatalogueGateway(): Pick<McpGateway, "listEntitledCatalogue" | "listInstalled" | "install">
{
	const installed = new Map<string, McpInstalledServer>(MCP_INSTALLED.map(function byServer(record: McpInstalledServer): [string, McpInstalledServer] { return [record.serverId, { ...record }]; }));

	return {
		listEntitledCatalogue: function listEntitledCatalogue()
		{
			return Promise.resolve(MCP_CATALOGUE.filter(function published(server) { return server.approvalStatus === McpApprovalStatus.Published; }).map(function clone(server) { return { ...server }; }));
		},
		listInstalled: function listInstalled()
		{
			return Promise.resolve(Array.from(installed.values(), function clone(record) { return { ...record }; }));
		},
		install: function install(serverId: string)
		{
			const server = MCP_CATALOGUE.find(function matching(candidate) { return candidate.id === serverId; });
			const connectionStatus = server?.type === McpServerType.MultiUser ? McpConnectionStatus.SharedKey : McpConnectionStatus.NeedsCredential;
			const record: McpInstalledServer = { serverId, connectionStatus, lastUsed: null };
			installed.set(serverId, record);
			return Promise.resolve({ ...record });
		}
	};
}

/** Storybook metadata for the user-facing MCP catalogue. */
const meta: Meta<CatalogueComponent> =
{
	title: "Tools/Catalogue",
	component: CatalogueComponent,
	tags: ["autodocs"],
	decorators: [applicationConfig({ providers: [provideRouter([{ path: "**", children: [] }]), { provide: MCP_GATEWAY, useFactory: _CreateCatalogueGateway }] })],
	parameters:
	{
		docs:
		{
			description:
			{
				component: "The browse-and-install surface for entitled MCP servers. Stories keep the published catalogue and installed markers reviewable without a live control plane."
			}
		}
	}
};

export default meta;

/** Local Storybook story type for the catalogue surface. */
type Story = StoryObj<CatalogueComponent>;

/** The default catalogue shows installed and installable servers together. */
export const Default: Story =
{
	tags: ["visual-test"],
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		await waitFor(function catalogueCardsLoaded() { expect(canvas.getByRole("button", { name: "Install" })).toBeVisible(); });
		await userEvent.click(canvas.getByRole("button", { name: "Install" }));
		await waitFor(function installedState() { expect(canvas.queryByRole("button", { name: "Install" })).not.toBeInTheDocument(); });
	},
	parameters:
	{
		docs:
		{
			description:
			{
				story: "The standard browse view with published servers, installed markers, and the approved-only explanation note."
			}
		}
	}
};
