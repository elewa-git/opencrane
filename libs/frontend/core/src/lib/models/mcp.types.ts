/**
 * Domain model for the MCP (Model Context Protocol) catalogue, installation, and governance
 * feature.
 *
 * These are the browser-safe projections of the OpenCrane
 * `/api/v1/mcp/...` contract shapes rendered by the catalogue UI.
 */

import type { McpConnectionFailureCodes, McpConnectionStatus, McpCredentialRequirement, McpInstallStates } from "@opencrane/contracts";

export { McpConnectionFailureCodes, McpConnectionStatus, McpCredentialRequirement, McpInstallStates } from "@opencrane/contracts";
export type { McpConnectionProjection } from "@opencrane/contracts";

/**
 * How the catalogue presents an MCP server connection.
 *
 * Mirrors the server-type values in the OpenCrane MCP API. Credential requirements describe
 * authentication material; the server-owned connection state determines readiness after discovery.
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
 * Server-declared credential-field metadata for catalogue presentation.
 *
 * Personal connection commands submit write-only material through the custody endpoint. They do
 * not turn these metadata fields into an arbitrary credential form or return submitted values.
 */
export interface McpCredentialField
{
	/** Stable field key declared by the server. */
	key: string;
	/** Human-readable field label. */
	label: string;
	/** Whether the server definition marks this field as required. */
	required: boolean;
	/** Whether the server definition marks this field as sensitive. */
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
	/** Durable installation lifecycle; Removing continues after the initiating request ends. */
	lifecycleState: McpInstallStates;
	/** Per-user connection status. */
	connectionStatus: McpConnectionStatus;
	/** Current admitted generation, or null before connection admission. */
	connectionGeneration: number | null;
	/** Time credential custody committed, or null when no credential was stored. */
	credentialUpdatedAt: string | null;
	/** Safe activation failure category, or null when no failure is reported. */
	failureCode: McpConnectionFailureCodes | null;
	/** Relative last-used label, or null when never used. */
	lastUsed: string | null;
}
