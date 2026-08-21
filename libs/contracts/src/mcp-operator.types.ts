/**
 * Operator-API contracts for consuming and governing MCP servers.
 *
 * These shapes back the `/api/v1/mcp/*` API the WeOwnAI frontend targets: the
 * entitlement-scoped catalogue, per-user installs / credential connect, and the
 * org-admin governance + access-policy endpoints. This is the sole public MCP contract; there is
 * no parallel unsiloed registry or credential-inventory API.
 *
 * Custody contract: NO type here ever carries credential material. A connected
 * install reports only its {@link McpConnectionStatus}; the secret lives in the
 * gateway plane (Obot). Neither the agent runtime nor the browser receives a provider URL or secret.
 */

/**
 * How a caller consumes a downstream MCP server.
 *
 * Returned as the `type` field on {@link McpCatalogServer}, and it decides what happens when a
 * user installs the server: a single-user server starts at `NeedsCredential` and must collect
 * the fields in `credentialSchema`; a multi-user server is already usable via the org-wide key;
 * a remote-OAuth server needs an OAuth handshake instead of a form.
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
 * Whether one user's install of a server is usable yet, and how it was connected.
 *
 * It reports only whether a credential is held and by what route — never the credential itself.
 * `Activating` and `ActivationFailed` are both transient-looking but only the first will change
 * on its own; a UI must offer a retry for the second.
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
