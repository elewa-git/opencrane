/**
 * Typed surface for OpenCrane's authenticated Obot v0.23.1 management + runtime
 * client (italanta/opencrane#128).
 *
 * Obot is authoritative for MCP server configuration, credential custody,
 * access-control, connect URLs, audit, and invocation. OpenCrane owns the product
 * workflow and a deterministic projection only, so every operation here maps to a
 * real Obot route — no OpenCrane-minted `cred_*`/`oauth_*` handles. The interface
 * abstracts the live HTTP path so the operator/servers logic is unit-testable
 * against a mock and the production client is wired in later (see `obot-client.ts`).
 *
 * Route references (pinned): https://github.com/obot-platform/obot/blob/v0.23.1
 *   pkg/api/router/router.go · apiclient/types/mcpserver.go · accesscontrolrule.go
 */

/** Obot deployment model for a server. Personal → singleUser; Shared → multiUser. */
export type ObotServerMode = "singleUser" | "multiUser";

/** Transport Obot advertises for a managed connection (streamable-http is the norm). */
export type ObotTransport = "streamable-http" | "sse";

/**
 * Readiness of an Obot server, derived FROM Obot — never from a locally minted
 * handle. `configured` means credentials/OAuth are satisfied and the server is
 * launchable; the other states are actionable gaps a caller surfaces to the user.
 */
export type ObotServerReadiness =
  | "configured"
  | "missing-headers"
  | "needs-oauth"
  | "deploying"
  | "error";

/** Stable identifiers Obot returns for a catalog entry OpenCrane imported/created. */
export interface ObotCatalogEntryRef
{
  /** Obot catalog this entry lives under. */
  catalogId: string;
  /** Obot catalog-entry id — persisted on `McpServer.obotCatalogEntryId`. */
  entryId: string;
  /** Pinned upstream version this entry was imported at (provenance). */
  pinnedVersion?: string;
  /** Content digest Obot reported for the pinned version (provenance). */
  digest?: string;
}

/** Stable identifiers Obot returns for a configured server or personal instance. */
export interface ObotServerRef
{
  /** Obot server id (shared/multiUser) — persisted on `McpServer.obotServerId`. */
  serverId: string;
  /** Obot instance id for a personal (singleUser) deployment, when applicable. */
  instanceId?: string;
  /** Deployment model this ref was created under. */
  mode: ObotServerMode;
}

/** Live state Obot reports for a server/instance, projected into OpenCrane. */
export interface ObotServerState
{
  /** Obot-derived readiness; drives `McpConnectionStatus`, never a local guess. */
  readiness: ObotServerReadiness;
  /**
   * The connect URL Obot returned for an entitled, configured server. Consumed
   * verbatim by the OpenClaw `mcp.servers` render — never reconstructed by hand.
   */
  connectUrl?: string;
  /** Transport the connect URL speaks. */
  transport?: ObotTransport;
  /** Header names still required before the server is `configured` (never values). */
  missingHeaders?: string[];
  /** Actionable error Obot reported, surfaced to the operator (redacted upstream). */
  error?: string;
}

/** Parameters to import/create a catalog entry (folded #218 curated import). */
export interface ObotUpsertCatalogEntryParams
{
  /** Obot catalog to write into. */
  catalogId: string;
  /** Human name for the entry. */
  name: string;
  /** Pinned upstream remote URL (standard registry records are streamable-http remotes). */
  remoteUrl: string;
  /** Version to pin the entry at — imports never track a moving upstream. */
  pinnedVersion: string;
  /** Upstream digest/provenance to record with the entry, when known. */
  digest?: string;
}

/** Parameters to deploy a server for a catalog entry in a given mode. */
export interface ObotCreateServerParams
{
  /** Catalog + entry the server is deployed from. */
  entry: ObotCatalogEntryRef;
  /** Personal (singleUser) or shared (multiUser) deployment. */
  mode: ObotServerMode;
  /** Owning user id (Obot subject) for a singleUser instance; omit for multiUser. */
  ownerObotUserId?: string;
}

/**
 * Parameters to configure credential material on an Obot server.
 *
 * `secrets` carries WRITE-ONLY material streamed server-side straight to Obot; it
 * MUST NEVER be persisted in OpenCrane, serialised in a response, logged, or placed
 * in an OpenClaw pod. The caller passes it through and discards it.
 */
export interface ObotConfigureServerParams
{
  /** The server/instance being configured. */
  server: ObotServerRef;
  /** Write-only header/API-key material, by header name. Never stored by OpenCrane. */
  secrets: Record<string, string>;
}

/** One access-control rule: a subject may reach a catalog-entry/server resource. */
export interface ObotAccessRule
{
  /** Obot subject: a stable user or group id. */
  subjectType: "user" | "group";
  /** Stable Obot user/group id (handles rename/deletion via id, not name). */
  subjectId: string;
  /** Resource the rule grants — a catalog entry or a specific server. */
  resourceType: "catalog-entry" | "server";
  /** Obot id of the granted resource. */
  resourceId: string;
}

/** Parameters to reconcile the FULL desired access-rule set for one resource. */
export interface ObotReconcileAccessParams
{
  /** Catalog the rules live under. */
  catalogId: string;
  /** Resource whose rules are being reconciled (entry or server id). */
  resourceId: string;
  /**
   * The complete desired rule set. Obot is made to match this exactly (rules absent
   * here are removed) so OpenCrane intent is the single authority and Obot is the
   * enforcement point. An empty set means default-deny — no access.
   */
  desired: ObotAccessRule[];
}

/** A tool Obot advertises for a configured server (runtime `tools/list`). */
export interface ObotToolDescriptor
{
  /** Tool name as Obot/the upstream server reports it. */
  name: string;
  /** Human description, when provided. */
  description?: string;
}

/**
 * A per-tenant Obot client credential (issue #128 decision: replaces the unused
 * projected `obot-gateway` k8s SA token). Obot API tokens are user-owned,
 * server-scoped, and expirable; OpenCrane mints, rotates, and revokes one per
 * OpenClaw identity through this adapter and never presents it as a downstream MCP key.
 */
export interface ObotClientToken
{
  /** Obot token id (for later rotation/revocation), safe to persist. */
  tokenId: string;
  /**
   * The bearer secret. WRITE-ONLY: handed to the tenant provisioning path to place
   * in the pod's credential mount — never logged, serialised in an API response, or
   * stored in an OpenCrane DB column.
   */
  secret: string;
  /** Expiry Obot assigned, when the token is time-bounded. */
  expiresAt?: string;
}

/** Parameters to mint a per-tenant Obot client token. */
export interface ObotMintTokenParams
{
  /** Obot user id the token is owned by (the OpenClaw identity). */
  ownerObotUserId: string;
  /** Tenant the token is minted for (audit/label context). */
  tenant: string;
}
