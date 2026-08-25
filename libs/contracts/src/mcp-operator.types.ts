/**
 * Operator-API contracts for consuming and governing MCP servers.
 *
 * These shapes back the `/api/v1/mcp/*` API the browser targets: the entitlement-scoped
 * catalogue, per-user installs, and org-admin governance + access endpoints. This is the sole
 * public MCP contract; there is no parallel unsiloed registry or credential-inventory API.
 *
 * Custody contract: NO type here ever carries credential material. A connected
 * install reports only its {@link McpConnectionStatus}; the secret lives in the
 * gateway plane (Obot). Neither the agent runtime nor the browser receives a provider URL or secret.
 */

/**
 * How a caller consumes a downstream MCP server.
 *
 * Returned as the `type` field on {@link McpCatalogServer}. Installing never starts a connection:
 * a single-user server still needs its credential collected before use; a multi-user server is
 * already usable via the org-wide key; a remote-OAuth server needs an OAuth handshake before use.
 * @see https://modelcontextprotocol.io/specification/2025-06-18
 */
export enum McpServerType
{
  /** Each user supplies their own credential, using the fields in `credentialSchema`. */
  SingleUser = "single-user",
  /** One org-wide shared key brokered for every caller (no per-user secret). */
  MultiUser = "multi-user",
  /** Remote OAuth — the caller authorises via an OAuth handshake. */
  RemoteOauth = "remote-oauth",
}

/**
 * Where a catalogue server sits in org-admin review.
 *
 * Only {@link McpApprovalStatus.Published} servers appear in the user-facing catalogue, so a
 * read path that forgets to filter on it exposes servers an admin has not released. `Approved`
 * is reviewed but deliberately not yet visible.
 */
export enum McpApprovalStatus
{
  /** Newly registered; awaiting an org-admin review. */
  PendingReview = "pending-review",
  /** Reviewed and approved, not yet visible to callers. */
  Approved = "approved",
  /** Live in the user-facing catalogue for entitled callers. */
  Published = "published",
  /** Withdrawn — hidden from the catalogue and not installable. */
  Disabled = "disabled",
}

/**
 * Reports whether an installed MCP server still needs external activation or is usable through an
 * administrator-managed shared key.
 *
 * The operator API returns these values from persisted install rows. OpenCrane currently has no
 * credential or OAuth activation command, so `NeedsCredential` cannot advance through this API.
 * Renaming either value requires matching database and API changes.
 */
export enum McpConnectionStatus
{
  /** The server is installed but remains unusable until an external custody flow activates it. */
  NeedsCredential = "needs-credential",
  /** The server is usable through an administrator-managed key; the caller supplies no credential. */
  SharedKey = "shared-key",
}

/**
 * One field a caller must supply to connect a {@link McpServerType.SingleUser}
 * server. Describes the input only — the submitted value is write-only.
 */
export interface CredentialField
{
  /** Stable key the value is submitted under. */
  key: string;
  /** Human-readable field label. */
  label: string;
  /** Whether the field must be supplied. */
  required: boolean;
  /** Whether the value is secret (masked input, never echoed back). */
  sensitive: boolean;
  /** Optional input placeholder. */
  placeholder?: string;
  /** Optional helper hint shown under the field. */
  hint?: string;
}

/**
 * A catalogue server as exposed by the operator API. Every field beyond `id` is optional so the same shape serves
 * both the entitled user catalogue and the richer admin governance view.
 */
export interface McpCatalogServer
{
  /** Stable server identifier. */
  id: string;
  /** Display name shown in the catalogue. */
  name?: string;
  /** Short caller-facing summary. */
  description?: string;
  /** Publishing organisation or author label. */
  publisher?: string;
  /** Glyph / icon key rendered by the frontend. */
  glyph?: string;
  /** Consumption shape; decides the credential-connect flow. */
  type?: McpServerType;
  /** Governance lifecycle status. */
  approvalStatus?: McpApprovalStatus;
  /** Credential fields a caller must supply to connect (single-user servers). */
  credentialSchema?: CredentialField[];
  /** Human-readable summary of who is entitled (admin governance view). */
  entitlementSummary?: string;
}

/**
 * A server installed by the calling user, with its connection state.
 */
export interface McpInstalled
{
  /** Identifier of the installed server. */
  serverId: string;
  /** Current connection state of this install. */
  connectionStatus?: McpConnectionStatus;
  /** ISO-8601 timestamp of last use, or null when never used. */
  lastUsed?: string | null;
}

/**
 * A user entitled to a server, rendered for the admin access editor and directory.
 */
export interface EntitledUser
{
  /** Stable local Principal identifier. */
  id: string;
  /** Display name. */
  name: string;
  /** Two-letter initials derived from the name. */
  initials: string;
  /** Deterministic avatar colour derived from the identifier. */
  color: string;
}

/**
 * A group that can receive an MCP authorization grant.
 *
 * The identifier is the durable local Group id. The name is display data and never participates
 * in an authorization decision.
 */
export interface EntitledGroup
{
  /** Stable local Group identifier used by authorization grants. */
  id: string;
  /** Human-readable group name shown in the access editor. */
  name: string;
}

/**
 * Projection of the authorization grants that let principals and groups use an MCP server.
 */
export interface McpAccessPolicy
{
  /** Identifier of the governed server. */
  serverId: string;
  /** Groups with an active allow grant for this server. */
  groups: EntitledGroup[];
  /** Principals with an active allow grant for this server. */
  users?: EntitledUser[];
}

/**
 * The selectable universe of users and groups for the admin access editor.
 */
export interface Directory
{
  /** All local principals that can receive an MCP authorization grant. */
  users: EntitledUser[];
  /** All local groups that can receive an MCP authorization grant. */
  groups: EntitledGroup[];
}
