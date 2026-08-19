import { provideRouter } from "@angular/router";
import { signal } from "@angular/core";
import { applicationConfig } from "@storybook/angular";
import type { Meta, StoryObj } from "@storybook/angular";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { McpAccessPolicy } from "@opencrane/core";
import { MCP_ACCESS_POLICIES, MCP_CATALOGUE, MCP_DIRECTORY } from "@opencrane/core/testing";
import { SessionStore, type Capabilities } from "@opencrane/state/core";
import { MCP_GATEWAY, McpGateway } from "@opencrane/state/mcp/adapter";

import { AccessPolicyComponent } from "../access-policy.component";

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

/** Creates an isolated policy gateway that returns saved grants on the next read. */
function _CreateAccessPolicyGateway(): Pick<McpGateway, "listCatalogue" | "getDirectory" | "getAccessPolicy" | "updateAccessPolicy">
{
	const policies = new Map<string, McpAccessPolicy>(Object.values(MCP_ACCESS_POLICIES).map(function byServer(policy: McpAccessPolicy): [string, McpAccessPolicy] { return [policy.serverId, { ...policy, groups: [...policy.groups], users: [...policy.users] }]; }));

	return {
		listCatalogue: function listCatalogue() { return Promise.resolve(MCP_CATALOGUE.map(function clone(server) { return { ...server }; })); },
		getDirectory: function getDirectory() { return Promise.resolve({ users: [...MCP_DIRECTORY.users], groups: [...MCP_DIRECTORY.groups] }); },
		getAccessPolicy: function getAccessPolicy(serverId: string)
		{
			const policy = policies.get(serverId) ?? { serverId, everyoneInOrg: false, groups: [], users: [] };
			return Promise.resolve({ ...policy, groups: [...policy.groups], users: [...policy.users] });
		},
		updateAccessPolicy: function updateAccessPolicy(serverId: string, policy: McpAccessPolicy)
		{
			const updated = { ...policy, serverId, groups: [...policy.groups], users: [...policy.users] };
			policies.set(serverId, updated);
			return Promise.resolve({ ...updated, groups: [...updated.groups], users: [...updated.users] });
		}
	};
}

/** Storybook metadata for the admin access-policy surface. */
const meta: Meta<AccessPolicyComponent> =
{
	title: "Tools/Access policy",
	component: AccessPolicyComponent,
	tags: ["autodocs"],
	decorators: [applicationConfig({ providers: [provideRouter([{ path: "**", children: [] }]), { provide: MCP_GATEWAY, useFactory: _CreateAccessPolicyGateway }, { provide: SessionStore, useValue: _ADMIN_SESSION }] })],
	parameters:
	{
		docs:
		{
			description:
			{
				component: "The entitlement editor for one MCP server. Stories keep the everyone-in-org, group, and user grants readable without a live policy backend."
			}
		}
	}
};

export default meta;

/** Local Storybook story type for the access-policy surface. */
type Story = StoryObj<AccessPolicyComponent>;

/** The editor opens on a selected server with live entitlement chips. */
export const SelectedPolicy: Story =
{
	tags: ["visual-test"],
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		await waitFor(function policyControlsLoaded() { expect(canvas.getAllByRole("combobox").length).toBeGreaterThan(0); });
		await userEvent.selectOptions(canvas.getAllByRole("combobox")[0], "Marketing");
		await waitFor(function savedGroup() { expect(canvas.getByText("Marketing", { selector: "span.wo-ap__chip" })).toBeVisible(); });
	},
	render: function render()
	{
		return { props: { server: "github" }, template: `<wo-access-policy [server]="server" />` };
	},
	parameters:
	{
		docs:
		{
			description:
			{
				story: "The normal edit state for a selected server, with org-wide, group, and user grants visible."
			}
		}
	}
};

/** The denied state explains the admin-only boundary. */
export const Denied: Story =
{
	decorators: [applicationConfig({ providers: [provideRouter([{ path: "**", children: [] }]), { provide: MCP_GATEWAY, useFactory: _CreateAccessPolicyGateway }, { provide: SessionStore, useValue: _DENIED_SESSION }] })],
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
