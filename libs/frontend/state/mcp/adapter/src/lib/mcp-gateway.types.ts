import { InjectionToken } from "@angular/core";

import { McpCredentialField, McpInstalledServer, McpServer } from "@opencrane/core";

/** Wire shape of a catalogue server. */
export interface McpServerWire
{
	/** Stable id / slug. */
	id: string;
	/** Display name. */
	name?: string;
	/** Short description. */
	description?: string;
	/** Publisher label. */
	publisher?: string;
	/** Tile glyph. */
	glyph?: string;
	/** Connection type (raw string). */
	type?: string;
	/** Lifecycle status (raw string). */
	approvalStatus?: string;
	/** Credential fields. */
	credentialSchema?: McpCredentialField[];
	/** Entitlement summary. */
	entitlementSummary?: string;
}

/** Wire shape of an installed-server record. */
export interface McpInstalledWire
{
	/** Catalogue server id. */
	serverId: string;
	/** Connection status (raw string). */
	connectionStatus?: string;
	/** Relative last-used label. */
	lastUsed?: string | null;
}

/**
 * Abstraction over the OpenCrane MCP catalogue and install operations backing
 * the user-facing Tools feature.
 *
 * Components depend only on this interface, so the data source can be swapped
 * (mock fixtures → live OpenCrane client) without touching the screens.
 * Implementations live in this `adapter` lib; the binding is provided in the
 * app's `app.config.ts`.
 *
 * Credential and OAuth activation are absent until a verified custody boundary
 * is composed.
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
	 * single-user or OAuth server remains pending external activation).
	 *
	 * @param serverId - The catalogue server id to install.
	 */
	install(serverId: string): Promise<McpInstalledServer>;

	/**
	 * Uninstall a server for the current user.
	 *
	 * @param serverId - The installed server id to remove.
	 */
	uninstall(serverId: string): Promise<void>;

	// --- Governance (the control plane requires the current Organization/Administer grant) ---

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

}

/** DI token for the active {@link McpGateway} implementation. */
export const MCP_GATEWAY: InjectionToken<McpGateway> = new InjectionToken<McpGateway>("WO_MCP_GATEWAY");
