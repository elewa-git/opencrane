import type { Meta, StoryObj } from "@storybook/angular";

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
	args: { server: _STRIPE, installed: _STRIPE_INSTALLED }
};

/** A connected OAuth server shows the account identity and disconnect action. */
export const ConnectedOauth: Story = {
	args: { server: _GITHUB, installed: _GITHUB_INSTALLED }
};

/** An administrator-managed server explains why no participant credential is required. */
export const SharedKey: Story = {
	args: { server: _POSTGRES, installed: _POSTGRES_INSTALLED }
};
