import type { JsonValue } from "@opencrane/util";

/**
 * Operator-API contracts for consuming and governing MCP servers.
 *
 * These shapes back the `/api/v1/mcp/*` API the WeOwnAI frontend targets: the
 * entitlement-scoped catalogue, per-user installs / credential connect, and the
 * governance endpoints protected by the central Organization/Administer grant. This is the sole
 * public MCP contract; there is
 * no parallel unsiloed registry or credential-inventory API.
 *
 * No type in this file carries submitted credentials. Installs expose connection status and form
 * metadata, so an API response cannot echo a provider secret or registry credential.
 */

/**
 * How the catalogue presents a downstream MCP connection.
 *
 * Returned as the `type` field on {@link McpCatalogServer}. The separate credential requirement
 * determines whether an installation needs activation; this presentation never grants readiness.
 * @see https://modelcontextprotocol.io/specification/2026-07-28
 */
export enum McpServerType
{
  /** Presents a connection configured by an individual user. */
  SingleUser = "single-user",
  /** Presents a connection intended for multiple users. */
  MultiUser = "multi-user",
  /** Presents a remote connection configured through OAuth. */
  RemoteOauth = "remote-oauth",
}

/**
 * Names the credential custody required before an installed MCP server can execute.
 *
 * Registration saves this value independently of connection presentation. Only Credentialless
 * installs can execute through the current API; the two credential-requiring modes remain
 * unavailable until a governed activation flow exists. Renaming a value changes the public and
 * persisted contract together.
 */
export enum McpCredentialRequirement
{
  /** The server can execute without any provider credential. */
  Credentialless = "credentialless",
  /** Execution requires a credential bound to the exact execution Principal. */
  PrincipalCredential = "principal-credential",
  /** Execution requires a governed credential shared by the owning organisation. */
  SharedCredential = "shared-credential",
}

/**
 * Where a catalogue server sits in review by a caller with Organization/Administer authority.
 *
 * Only {@link McpApprovalStatus.Published} servers appear in the user-facing catalogue, so a
 * read path that forgets to filter on it exposes servers an admin has not released. `Approved`
 * is reviewed but deliberately not yet visible.
 */
export enum McpApprovalStatus
{
  /** Newly registered; awaiting review by a caller with Organization/Administer authority. */
  PendingReview = "pending-review",
  /** Reviewed and approved, not yet visible to callers. */
  Approved = "approved",
  /** Live in the user-facing catalogue for entitled callers. */
  Published = "published",
  /** Withdrawn — hidden from the catalogue and not installable. */
  Disabled = "disabled",
}

/**
 * Reports whether an installed MCP server needs credential activation or requires no credential.
 *
 * The operator API returns these values from persisted install rows. OpenCrane currently has no
 * credential or OAuth activation command, so `NeedsCredential` cannot advance through this API.
 * Renaming either value requires matching database and API changes.
 */
export enum McpConnectionStatus
{
  /** The install is saved but this API cannot use it until credential setup exists. */
  NeedsCredential = "needs-credential",
  /** The installed server requires no credential; execution still checks current authority. */
  Credentialless = "credentialless",
}

/**
 * Reports whether current server governance permits a tool revision to be assigned.
 *
 * The operator API sends this value in catalogue and administrator responses. `Assignable` means
 * the server is both published and active, but it never grants the caller permission to use the
 * tool. User-facing reads still require an allow decision, and execution rechecks authority. An
 * unknown value must be treated as blocked because this is a closed API vocabulary.
 */
export enum McpToolRevisionEligibility
{
	/** The server is published and active; separate caller authorization is still required. */
	Assignable = "assignable",
	/** The server is unpublished or inactive, so no assignment may select this revision. */
	GovernanceBlocked = "governance-blocked",
}

/**
 * Reports the discovery state that made one tool schema available for assignment.
 *
 * The operator API returns tool rows only from a server revision stored as Ready, so `Ready` is the
 * sole value today. A server with no Ready revision returns no tool rows. This field records why the
 * schema may be considered; it grants no execution permission by itself.
 */
export enum McpToolRevisionReadiness
{
	/** Discovery saved the protocol version and input schema for the selected server revision. */
	Ready = "ready",
}

/**
 * Names one immutable OCI-backed MCP tool schema that an agent author can select.
 *
 * The catalogue selects the newest Ready server revision, then returns its tools in stable name and
 * identifier order. User responses contain these rows only after entitlement filtering. The
 * administrator response may include governance-blocked rows for diagnosis, but seeing a row never
 * grants execution authority.
 */
export interface McpAssignableToolRevision
{
	/** Identifies the immutable tool revision saved from discovery. */
	toolRevisionId: string;
	/** Identifies the newest Ready server revision selected for this catalogue response. */
	serverRevisionId: string;
	/** Gives the MCP tool name sent to the runtime. */
	name: string;
	/** Gives the tool description saved by discovery, or null when the server omitted it. */
	description: string | null;
	/** Carries the input JSON Schema frozen for this tool revision. */
	inputSchema: JsonValue;
	/** Binds the response schema to the digest checked again during run admission. */
	inputSchemaDigest: string;
	/** Reports whether current server governance permits assignment without granting caller access. */
	eligibility: McpToolRevisionEligibility;
	/** Reports the discovery state that made this immutable schema available. */
	readiness: McpToolRevisionReadiness;
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
 * A catalogue server as exposed by the operator API. Display metadata stays optional so the same
 * shape serves the entitled user catalogue and the richer admin governance view. `tools` is always
 * present and is empty when the server has no Ready OCI revision.
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
  /** Connection presentation; does not determine installation readiness. */
  type?: McpServerType;
  /** Explicit credential requirement, independent of connection presentation. */
  credentialRequirement: McpCredentialRequirement;
  /** Governance lifecycle status. */
  approvalStatus?: McpApprovalStatus;
  /** Fields declared for credential setup; this API cannot accept their values or activate a connection. */
  credentialSchema?: CredentialField[];
  /** Human-readable summary of who is entitled (admin governance view). */
  entitlementSummary?: string;
	/** Lists tools from the newest Ready OCI server revision; an empty array means none are assignable. */
	tools: McpAssignableToolRevision[];
}

/**
 * A server installed by the calling user, with its connection state.
 */
export interface McpInstalled
{
  /** Identifier of the installed server. */
  serverId: string;
  /** Current connection state of this install. */
  connectionStatus: McpConnectionStatus;
  /** ISO-8601 timestamp of last use, or null when never used. */
  lastUsed?: string | null;
}
