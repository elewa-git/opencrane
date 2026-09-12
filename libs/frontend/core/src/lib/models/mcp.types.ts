/**
 * Domain model for the MCP (Model Context Protocol) catalogue, installation, and governance
 * feature.
 *
 * These are the browser-safe projections of the OpenCrane
 * `/api/v1/mcp/...` contract shapes rendered by the catalogue UI.
 */

import type { McpCredentialRequirement } from "@opencrane/contracts";

export { McpCredentialRequirement } from "@opencrane/contracts";

/**
 * How the catalogue presents an MCP server connection.
 *
 * Mirrors the server-type values in the OpenCrane MCP API. The separate credential requirement
 * controls readiness; this presentation does not provide a browser activation flow.
 */
export enum McpServerType
{
	/** Presents a connection configured for an individual user. */
	SingleUser = "single-user",
	/** Presents a connection intended for multiple users. */
	MultiUser = "multi-user",
	/** Presents a remote connection intended for OAuth activation. */
	RemoteOauth = "remote-oauth"
}

/**
 * Governance lifecycle state of a server in the admin catalogue.
 *
 * Only `Published` (and entitled) servers are visible to regular users.
 * `Disabled` is the single terminal "off" state; a rejected server returns to
 * the admin's draft set rather than carrying a distinct terminal status.
 */
export enum McpApprovalStatus
{
	/** Awaiting admin review; not visible to users. */
	PendingReview = "pending-review",
	/** Reviewed and approved, but not yet user-visible. */
	Approved = "approved",
	/** Published — installable by entitled users. */
	Published = "published",
	/** Turned off after publication; hidden from users. */
	Disabled = "disabled"
}

/**
 * Determines whether the Tools UI presents an installed MCP server as awaiting external activation
 * or requiring no credential.
 *
 * The adapter maps the operator API's two retained string values into this closed set. OpenCrane has
 * no browser credential or OAuth activation command, so `NeedsCredential` is informational here.
 */
export enum McpConnectionStatus
{
	/** The install remains unusable until a custody flow outside the current browser API activates it. */
	NeedsCredential = "needs-credential",
	/** The installed server requires no credential; execution still checks current authority. */
	Credentialless = "credentialless"
}

/**
 * Server-declared credential-field metadata for a future governed custody flow.
 *
 * The current browser API neither renders nor submits credential values.
 */
export interface McpCredentialField
{
	/** Stable field key declared by the server. */
	key: string;
	/** Human-readable field label. */
	label: string;
	/** Whether a future activation flow must supply the field. */
	required: boolean;
	/** Whether a future activation UI must treat the value as a write-only secret. */
	sensitive: boolean;
	/** Optional placeholder metadata. */
	placeholder?: string;
	/** Optional helper-text metadata. */
	hint?: string;
}

/**
 * A server entry in the MCP catalogue.
 */
export interface McpServer
{
	/** Stable id / slug (rendered in mono). */
	id: string;
	/** Display/technical name. */
	name: string;
	/** Short, one-line description. */
	description: string;
	/** Publisher / vendor label. */
	publisher: string;
	/** Two-letter glyph for the catalogue tile. */
	glyph: string;
	/** Connection presentation; does not determine credential readiness. */
	type: McpServerType;
	/** Credential custody required before an installation can execute. */
	credentialRequirement: McpCredentialRequirement;
	/** Governance lifecycle status. */
	approvalStatus: McpApprovalStatus;
	/** Server-declared credential field metadata; empty when no field form is supplied. */
	credentialSchema: McpCredentialField[];
	/** Short entitlement summary for the admin table (e.g. "Everyone (org)"). */
	entitlementSummary: string;
}

/**
 * A server the current user has installed, with live per-user connection state.
 *
 * Joined to its {@link McpServer} by {@link serverId} in the view layer.
 */
export interface McpInstalledServer
{
	/** The catalogue server id this record belongs to. */
	serverId: string;
	/** Per-user connection status. */
	connectionStatus: McpConnectionStatus;
	/** Relative last-used label, or null when never used. */
	lastUsed: string | null;
}
