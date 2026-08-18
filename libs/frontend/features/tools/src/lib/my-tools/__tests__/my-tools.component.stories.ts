import { provideRouter } from "@angular/router";
import { applicationConfig } from "@storybook/angular";
import type { Meta, StoryObj } from "@storybook/angular";

import { McpApprovalStatus } from "@opencrane/core";
import { MCP_CATALOGUE, MCP_INSTALLED } from "@opencrane/core/testing";
import { MCP_GATEWAY } from "@opencrane/state/mcp/adapter";

import { MyToolsComponent } from "../my-tools.component";

const _MCP_GATEWAY_FIXTURE = {
	listEntitledCatalogue: function listEntitledCatalogue() { return Promise.resolve(MCP_CATALOGUE.filter(function published(server) { return server.approvalStatus === McpApprovalStatus.Published; })); },
	listInstalled: function listInstalled() { return Promise.resolve(MCP_INSTALLED); },
	uninstall: function uninstall() { return Promise.resolve(); },
	setCredential: function setCredential() { return Promise.resolve(MCP_INSTALLED[0]); },
	removeCredential: function removeCredential() { return Promise.resolve(MCP_INSTALLED[0]); },
	connectOauth: function connectOauth() { return Promise.resolve(MCP_INSTALLED[0]); },
	disconnect: function disconnect() { return Promise.resolve(MCP_INSTALLED[0]); }
};

const meta: Meta<MyToolsComponent> = {
	title: "Tools/My tools",
	component: MyToolsComponent,
	tags: ["autodocs"],
	decorators: [applicationConfig({ providers: [provideRouter([]), { provide: MCP_GATEWAY, useValue: _MCP_GATEWAY_FIXTURE }] })],
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
