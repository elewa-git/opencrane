/**
 * Domain model for the MCP (Model Context Protocol) catalogue, credential
 * connect, and activation feature.
 *
 * These are the browser-safe projections of the OpenCrane
 * `/api/v1/mcp/...` contract shapes rendered by the catalogue UI.
 */

/**
 * How a user connects their identity to an MCP server — drives the Connect UX.
 *
 * Mirrors the Obot server-type taxonomy in the OpenCrane spec.
 */
export enum McpServerType
{
	/** The user supplies their own credential (an API token). */
	SingleUser = "single-user",
	/** An admin pre-sets a shared key; the user is never prompted. */
	MultiUser = "multi-user",
	/** Browser OAuth consent flow against the provider. */
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
 * or ready through an administrator-managed key.
 *
 * The adapter maps the operator API's two retained string values into this closed set. OpenCrane has
 * no browser credential or OAuth activation command, so `NeedsCredential` is informational here.
 */
export enum McpConnectionStatus
{
	/** The install remains unusable until a custody flow outside the current browser API activates it. */
	NeedsCredential = "needs-credential",
	/** The install is usable through an administrator-managed key and needs no user action. */
	SharedKey = "shared-key"
}

/**
 * One configurable credential field from a server's config schema.
 *
 * For single-user servers, the Connect form is rendered from these fields.
 * A `sensitive` field is write-only: it is masked, never returned to the
 * browser, and never echoed back after being saved.
 */
export interface McpCredentialField
{
	/** Stable key sent to the control plane. */
	key: string;
	/** Human-readable field label. */
	label: string;
	/** Whether the field is mandatory. */
	required: boolean;
	/** Whether the value is a secret (write-only, masked, never read back). */
	sensitive: boolean;
	/** Placeholder shown in the empty input. */
	placeholder?: string;
	/** Optional hint rendered under the field. */
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
	/** Connection type — drives the Connect UX. */
	type: McpServerType;
	/** Governance lifecycle status. */
	approvalStatus: McpApprovalStatus;
	/** Credential fields for single-user servers (empty for multi-user / OAuth). */
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

/** A user that can be granted access to a server (entitlement target). */
export interface McpEntitledUser
{
	/** Stable user id. */
	id: string;
	/** Display name. */
	name: string;
	/** Two-letter avatar initials. */
	initials: string;
}

/** A stable local group that can receive an MCP authorization grant. */
export interface McpEntitledGroup
{
	/** Stable local Group identifier used by authorization grants. */
	id: string;
	/** Human-readable group name shown in the access editor. */
	name: string;
}

/**
 * Access policy for one server — which stable local groups and Principals may install it.
 */
export interface McpAccessPolicy
{
	/** The server this policy governs. */
	serverId: string;
	/** Entitled stable local groups. */
	groups: McpEntitledGroup[];
	/** Entitled individual users. */
	users: McpEntitledUser[];
}

/** Candidate users + groups an admin can add to a policy. */
export interface McpDirectory
{
	/** All assignable users. */
	users: McpEntitledUser[];
	/** All assignable stable local groups. */
	groups: McpEntitledGroup[];
}
