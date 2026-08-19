import type { Meta, StoryObj } from "@storybook/angular";
import { expect, userEvent, within } from "storybook/test";

import { McpConnectionStatus } from "@opencrane/core";
import { MCP_CATALOGUE, MCP_INSTALLED } from "@opencrane/core/testing";

import { ConnectDrawerComponent } from "../connect-drawer.component";

const _STRIPE = MCP_CATALOGUE.find(function find(server) { return server.id === "stripe" })!;
const _GITHUB = MCP_CATALOGUE.find(function find(server) { return server.id === "github" })!;
const _POSTGRES = MCP_CATALOGUE.find(function find(server) { return server.id === "postgres-prod" })!;
const _STRIPE_INSTALLED = MCP_INSTALLED.find(function find(record) { return record.serverId === "stripe" })!;
const _GITHUB_INSTALLED = MCP_INSTALLED.find(function find(record) { return record.serverId === "github" })!;
const _POSTGRES_INSTALLED = MCP_INSTALLED.find(function find(record) { return record.serverId === "postgres-prod" })!;

const meta: Meta<ConnectDrawerComponent> = {
	title: "Tools/Connect drawer",
	component: ConnectDrawerComponent,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component: "The secure connection surface for MCP servers. Stories keep write-only credentials, OAuth account state, and administrator-managed credentials visibly distinct."
			}
		}
	}
};

export default meta;
type Story = StoryObj<ConnectDrawerComponent>;

/** A single-user server starts with an empty write-only credential form. */
export const SingleUserCredential: Story = {
	tags: ["visual-test"],
	args: { server: _STRIPE, installed: _STRIPE_INSTALLED },
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("button", { name: "Save & connect" })).toBeDisabled();
	}
};

/** A stored single-user credential stays masked until the user chooses Replace. */
export const StoredCredential: Story = {
	tags: ["visual-test"],
	args: { server: _STRIPE, installed: { ..._STRIPE_INSTALLED, connectionStatus: McpConnectionStatus.Connected } },
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Replace" }));
		await expect(canvas.getAllByRole("textbox")[0]).toBeVisible();
	}
};

/** A disconnected OAuth server offers the provider consent action. */
export const DisconnectedOauth: Story = {
	tags: ["visual-test"],
	args: { server: _GITHUB, installed: { ..._GITHUB_INSTALLED, connectionStatus: McpConnectionStatus.NeedsCredential } },
	render: function render(args) { return { props: { ...args, connectCount: 0 }, template: `<wo-connect-drawer [server]="server" [installed]="installed" (connectRequested)="connectCount = connectCount + 1" /><output data-testid="connect-count" [attr.data-count]="connectCount"></output>` }; },
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: /Connect with OAuth/iu }));
		await expect(canvas.getByTestId("connect-count")).toHaveAttribute("data-count", "1");
	}
};

/** A connected OAuth server shows the account identity and disconnect action. */
export const ConnectedOauth: Story = {
	tags: ["visual-test"],
	args: { server: _GITHUB, installed: _GITHUB_INSTALLED },
	render: function render(args) { return { props: { ...args, disconnectCount: 0 }, template: `<wo-connect-drawer [server]="server" [installed]="installed" (disconnectRequested)="disconnectCount = disconnectCount + 1" /><output data-testid="disconnect-count" [attr.data-count]="disconnectCount"></output>` }; },
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Disconnect" }));
		await expect(canvas.getByTestId("disconnect-count")).toHaveAttribute("data-count", "1");
	}
};

/** An administrator-managed server explains why no participant credential is required. */
export const SharedKey: Story = {
	tags: ["visual-test"],
	args: { server: _POSTGRES, installed: _POSTGRES_INSTALLED },
	render: function render(args) { return { props: { ...args, closeCount: 0 }, template: `<wo-connect-drawer [server]="server" [installed]="installed" (closed)="closeCount = closeCount + 1" /><output data-testid="close-count" [attr.data-count]="closeCount"></output>` }; },
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Close" }));
		await expect(canvas.getByTestId("close-count")).toHaveAttribute("data-count", "1");
	}
};
