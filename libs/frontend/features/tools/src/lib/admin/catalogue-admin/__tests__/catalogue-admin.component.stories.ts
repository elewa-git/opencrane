import { provideRouter } from "@angular/router";
import { signal } from "@angular/core";
import { applicationConfig } from "@storybook/angular";
import type { Meta, StoryObj } from "@storybook/angular";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { McpApprovalStatus, McpServer } from "@opencrane/core";
import { MCP_CATALOGUE } from "@opencrane/core/testing";
import { SessionStore, type Capabilities } from "@opencrane/state/core";
import { MCP_GATEWAY, McpGateway } from "@opencrane/state/mcp/adapter";

import { CatalogueAdminComponent } from "../catalogue-admin.component";

/** Gives the governance story one approved server while retaining every other shared state. */
const _ADMIN_CATALOGUE = MCP_CATALOGUE.map(function withApprovedState(server: McpServer): McpServer
{
	if (server.id !== "linear") return { ...server };
	return { ...server, approvalStatus: McpApprovalStatus.Approved };
});

/** Session fixture that behaves like a customer admin. */
const _ADMIN_SESSION =
{
	capabilities: signal<Capabilities>({
		isOperator: false,
		isPlatformOperator: false,
		customerAdmin: true,
		manageCustomers: false,
		managePolicies: true,
		manageBudgets: false
	})
} as Pick<SessionStore, "capabilities">;

/** Session fixture that shows the denied state. */
const _DENIED_SESSION =
{
	capabilities: signal<Capabilities>({
		isOperator: false,
		isPlatformOperator: false,
		customerAdmin: false,
		manageCustomers: false,
		managePolicies: false,
		manageBudgets: false
	})
} as Pick<SessionStore, "capabilities">;

/** Creates an isolated governance gateway that retains lifecycle changes after reloads. */
function _CreateAdminCatalogueGateway(): Pick<McpGateway, "listCatalogue" | "approve" | "publish" | "reject" | "setEnabled">
{
	const catalogue = new Map<string, McpServer>(_ADMIN_CATALOGUE.map(function byId(server: McpServer): [string, McpServer] { return [server.id, { ...server }]; }));

	/** Applies one governance state transition to the requested server. */
	function _SetStatus(serverId: string, approvalStatus: McpApprovalStatus): McpServer
	{
		const current = catalogue.get(serverId);
		if (!current) throw new Error(`Unknown MCP server: ${serverId}`);
		const updated = { ...current, approvalStatus };
		catalogue.set(serverId, updated);
		return { ...updated };
	}

	return {
		listCatalogue: function listCatalogue() { return Promise.resolve(Array.from(catalogue.values(), function clone(server) { return { ...server }; })); },
		approve: function approve(serverId: string) { return Promise.resolve(_SetStatus(serverId, McpApprovalStatus.Approved)); },
		publish: function publish(serverId: string) { return Promise.resolve(_SetStatus(serverId, McpApprovalStatus.Published)); },
		reject: function reject(serverId: string) { return Promise.resolve(_SetStatus(serverId, McpApprovalStatus.Disabled)); },
		setEnabled: function setEnabled(serverId: string, enabled: boolean) { return Promise.resolve(_SetStatus(serverId, enabled ? McpApprovalStatus.Published : McpApprovalStatus.Disabled)); }
	};
}

/** Storybook metadata for the admin catalogue surface. */
const meta: Meta<CatalogueAdminComponent> =
{
	title: "Tools/Admin catalogue",
	component: CatalogueAdminComponent,
	tags: ["autodocs"],
	decorators: [applicationConfig({ providers: [provideRouter([{ path: "**", children: [] }]), { provide: MCP_GATEWAY, useFactory: _CreateAdminCatalogueGateway }, { provide: SessionStore, useValue: _ADMIN_SESSION }] })],
	parameters:
	{
		docs:
		{
			description:
			{
				component: "The org-admin governance surface for MCP servers. Stories keep approved, pending-review, published, and disabled states visible without a live control plane."
			}
		}
	}
};

export default meta;

/** Local Storybook story type for the admin catalogue surface. */
type Story = StoryObj<CatalogueAdminComponent>;

/** The admin catalogue shows governance actions for every server state. */
export const AdminView: Story =
{
	tags: ["visual-test"],
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		await waitFor(function catalogueRowsLoaded() { expect(canvas.getByRole("button", { name: "Approve" })).toBeVisible(); });
		await userEvent.click(canvas.getAllByRole("button", { name: "Approve" })[0]);
		await waitFor(function approvedState() { expect(canvas.getByRole("button", { name: "Publish" })).toBeVisible(); });
	},
	parameters:
	{
		docs:
		{
			description:
			{
				story: "The governance table with pending-review, approved, published, and disabled rows plus their action buttons."
			}
		}
	}
};

/** The denied state explains why a non-admin cannot reach the governance table. */
export const Denied: Story =
{
	decorators: [applicationConfig({ providers: [provideRouter([{ path: "**", children: [] }]), { provide: MCP_GATEWAY, useFactory: _CreateAdminCatalogueGateway }, { provide: SessionStore, useValue: _DENIED_SESSION }] })],
	parameters:
	{
		docs:
		{
			description:
			{
				story: "The access-gated state for users without the customer-admin capability."
			}
		}
	}
};
