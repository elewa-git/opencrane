import { InjectionToken } from "@angular/core";

import { McpAccessPolicy, McpDirectory, McpInstalledServer, McpServer } from "@opencrane/core";

/**
 * Abstraction over the OpenCrane MCP catalogue / credential / activation reads
 * and writes backing the user-facing Tools feature.
 *
 * Components depend only on this interface, so the data source can be swapped
 * (mock fixtures → live OpenCrane client) without touching the screens.
 * Implementations live in this `adapter` lib; the binding is provided in the
 * app's `app.config.ts`.
 *
 * **Security contract.** {@link setCredential} is the only path a secret enters,
 * and it is write-only: a stored credential is never returned by any read
 * method. The agent/LLM/chat never sees a token or provider URL, so no method here exposes raw
 * credential material or provider addressing.
 */
export interface McpGateway
{
	/**
	 * List the servers the current user may install — published **and** entitled
	 * to them. Pending/unapproved/unentitled servers are never returned here.
	 */
	listEntitledCatalogue(): Promise<McpServer[]>;

	/** List the servers the current user has installed, with connection state. */
	listInstalled(): Promise<McpInstalledServer[]>;

	/**
	 * Install a server for the current user. Resolves with the new installed
	 * record; its initial {@link McpInstalledServer.connectionStatus} depends on
	 * the server type (a shared-key multi-user server is ready immediately; a
	 * single-user or OAuth server still needs a credential / connect).
	 *
	 * @param serverId - The catalogue server id to install.
	 */
	install(serverId: string): Promise<McpInstalledServer>;

	/**
	 * Uninstall a server for the current user (also clears any stored credential).
	 *
	 * @param serverId - The installed server id to remove.
	 */
	uninstall(serverId: string): Promise<void>;

	/**
	 * Set (or replace) the credential for a single-user server. Write-only: the
	 * values are sent to the control plane and never returned to the browser.
	 * Resolves with the updated installed record (now connected/activating).
	 *
	 * @param serverId - The server the credential is for.
	 * @param values   - Field key → value map from the server's config schema.
	 */
	setCredential(serverId: string, values: Record<string, string>): Promise<McpInstalledServer>;

	/**
	 * Remove a stored single-user credential, returning the server to the
	 * "needs credential" state.
	 *
	 * @param serverId - The server whose credential to remove.
	 */
	removeCredential(serverId: string): Promise<McpInstalledServer>;

	/**
	 * Complete the OAuth connect for a remote server. In production this follows
	 * the provider consent redirect; the mock resolves directly to a connected
	 * account. Resolves with the updated installed record.
	 *
	 * @param serverId - The remote/OAuth server to connect.
	 */
	connectOauth(serverId: string): Promise<McpInstalledServer>;

	/**
	 * Disconnect an OAuth/token connection, returning the server to the
	 * "needs credential" state without uninstalling it.
	 *
	 * @param serverId - The connected server to disconnect.
	 */
	disconnect(serverId: string): Promise<McpInstalledServer>;

	// --- Admin (org-admin only; the control plane enforces authorisation) ---

	/**
	 * List **every** server in the catalogue, including pending/unapproved and
	 * disabled ones — the admin governance view. (Contrast
	 * {@link listEntitledCatalogue}, which returns only published + entitled.)
	 */
	listCatalogue(): Promise<McpServer[]>;

	/**
	 * Approve a pending server (review cleared), returning the updated server.
	 *
	 * @param serverId - The server to approve.
	 */
	approve(serverId: string): Promise<McpServer>;

	/**
	 * Publish an approved server, making it installable by entitled users.
	 *
	 * @param serverId - The server to publish.
	 */
	publish(serverId: string): Promise<McpServer>;

	/**
	 * Reject a pending server (declined; hidden from users).
	 *
	 * @param serverId - The server to reject.
	 */
	reject(serverId: string): Promise<McpServer>;

	/**
	 * Enable or disable a published server.
	 *
	 * @param serverId - The server to toggle.
	 * @param enabled  - `true` to (re)publish, `false` to disable.
	 */
	setEnabled(serverId: string, enabled: boolean): Promise<McpServer>;

	/**
	 * Load the access policy (entitlements) for a server.
	 *
	 * @param serverId - The server whose policy to read.
	 */
	getAccessPolicy(serverId: string): Promise<McpAccessPolicy>;

	/**
	 * Replace the access policy for a server, returning the saved policy.
	 *
	 * @param serverId - The server whose policy to update.
	 * @param policy   - The new entitlement set (everyone-in-org, groups, users).
	 */
	updateAccessPolicy(serverId: string, policy: McpAccessPolicy): Promise<McpAccessPolicy>;

	/** List the users + groups an admin can add to a policy. */
	getDirectory(): Promise<McpDirectory>;
}

/** DI token for the active {@link McpGateway} implementation. */
export const MCP_GATEWAY: InjectionToken<McpGateway> = new InjectionToken<McpGateway>("WO_MCP_GATEWAY");
