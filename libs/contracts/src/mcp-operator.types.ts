/**
 * Operator-API contracts for the MCP consumption + governance surface.
 *
 * These shapes back the `/api/v1/mcp/*` API the WeOwnAI frontend targets: the
 * entitlement-scoped catalogue, per-user installs / credential connect, and the
 * org-admin governance + access-policy endpoints. They sit ON TOP of the existing
 * `/mcp-servers` admin registry (whose source-of-truth shape is {@link McpServer}
 * in `mcp-server.types.ts`) rather than replacing it.
 *
 * Custody contract: NO type here ever carries credential material. A connected
 * install reports only its {@link McpConnectionStatus}; the secret lives in the
 * gateway plane (Obot). Neither the agent runtime nor the browser receives a provider URL or secret.
 */

/**
 * How a caller consumes a downstream MCP server. Surfaced as the `type` field on
 * {@link McpCatalogServer} and decides the initial install connection state.
 */
export enum McpServerType
{
  /** Each caller authors their own credential (per-user secret). */
  SingleUser = "single-user",
  /** One org-wide shared key brokered for every caller (no per-user secret). */
  MultiUser = "multi-user",
  /** Remote OAuth — the caller authorises via an OAuth handshake. */
  RemoteOauth = "remote-oauth",
}

/**
 * Org-admin governance lifecycle of a catalogue server. Only
 * {@link McpApprovalStatus.Published} servers reach the user-facing catalogue.
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
 * Per-user install connection state. Reports custody state only — never the
 * underlying secret material.
 */
export enum McpConnectionStatus
{
  /** Installed but no credential authored yet. */
  NeedsCredential = "needs-credential",
  /** Credential submitted; the gateway is establishing the connection. */
  Activating = "activating",
  /** Connected via a per-user credential. */
  Connected = "connected",
  /** Connected via a remote OAuth handshake. */
  OauthConnected = "oauth-connected",
  /** Connected via the org-wide shared key (multi-user servers). */
  SharedKey = "shared-key",
  /** The gateway failed to establish the connection. */
  ActivationFailed = "activation-failed",
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
 * A catalogue server as exposed by the operator API (distinct from the registry
 * {@link McpServer}). Every field beyond `id` is optional so the same shape serves
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
 * A server installed by the calling user, with its connection state. Never carries
 * credential material — `connectedAccount` is a non-secret display label only.
 */
export interface McpInstalled
{
  /** Identifier of the installed server. */
  serverId: string;
  /** Current connection state of this install. */
  connectionStatus?: McpConnectionStatus;
  /** ISO-8601 timestamp of last use, or null when never used. */
  lastUsed?: string | null;
  /** Non-secret display label of the connected account (e.g. an email). */
  connectedAccount?: string;
}

/**
 * A user entitled to a server, rendered for the admin access editor and directory.
 */
export interface EntitledUser
{
  /** Stable user identifier (sub or email). */
  id: string;
  /** Display name. */
  name: string;
  /** Two-letter initials derived from the name. */
  initials: string;
  /** Deterministic avatar colour derived from the identifier. */
  color: string;
}

/**
 * Org-admin access policy deciding which callers may see and install a server.
 */
export interface McpAccessPolicy
{
  /** Identifier of the governed server. */
  serverId: string;
  /** When true, every caller in the org is entitled (lists are ignored). */
  everyoneInOrg?: boolean;
  /** Entitled group identifiers / names. */
  groups?: string[];
  /** Entitled individual users. */
  users?: EntitledUser[];
}

/**
 * The selectable universe of users and groups for the admin access editor.
 */
export interface Directory
{
  /** All known users that can be entitled. */
  users: EntitledUser[];
  /** All known group identifiers / names that can be entitled. */
  groups: string[];
}
