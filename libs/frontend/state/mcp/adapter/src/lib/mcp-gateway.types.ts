import { InjectionToken } from "@angular/core";

import { McpInstalledServer, McpServer, type McpConnectionProjection } from "@opencrane/core";
import type { paths } from "@opencrane/contracts";

/** Generated catalogue response interpreted by the MCP model mapper. */
export type McpServerWire = paths["/mcp/catalog"]["get"]["responses"][200]["content"]["application/json"][number];

/** Generated installed-server response interpreted by the MCP model mapper. */
export type McpInstalledWire = paths["/mcp/installed"]["get"]["responses"][200]["content"]["application/json"][number];

/** Generated write-only command; retry the same key and material after an uncertain response. */
export type McpConnectionCommand = paths["/mcp/installed/{serverId}/connection"]["put"]["requestBody"]["content"]["application/json"];

/**
 * Tells the command store whether it must retain an exact retry or discard private drafts.
 * These adapter-only categories are not persisted or sent to the server. Unknown HTTP failures
 * become Uncertain because they do not prove that the command was rejected.
 */
export enum McpConnectionCommandFailureKinds
{
	/** The server rejected the command shape; discard this attempt before another user intent. */
	Rejected = "rejected",
	/** The server no longer exposes this connection to the caller; discard its draft and refresh. */
	Unavailable = "unavailable",
	/** Saved work conflicts with this command; discard its draft and refresh before a new intent. */
	Conflict = "conflict",
	/** Authentication or authorization changed; purge all private command state. */
	AccessChanged = "access-changed",
	/** The command may have committed; retain its key and material for an identical retry. */
	Uncertain = "uncertain",
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
 * Personal connection commands accept ephemeral write-only material. Responses never expose it.
 * OAuth remains outside this port.
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
	 * record. A ready credentialless OCI server can execute immediately. Every remote server,
	 * including a credentialless one, needs a personal connection command and discovery before use.
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

	/** Save a personal connection command through server custody; never cache its bearer token. */
	activatePersonalConnection(serverId: string, command: McpConnectionCommand): Promise<McpConnectionProjection>;

	/** Revoke the observed personal generation; an identical retry retains its key and generation. */
	revokePersonalConnection(serverId: string, idempotencyKey: string, expectedGeneration: number): Promise<McpConnectionProjection>;

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
