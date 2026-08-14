import type { Grant } from "./grant.types";
import { GrantScope } from "./grant.types";

/**
 * How an MCP server is reached over the wire.
 *
 * OpenCrane stores this centrally so the gateway can be told which transport to speak when it
 * brokers calls on a tenant's behalf. A caller never opens the transport itself.
 * @see https://modelcontextprotocol.io/specification/2025-06-18
 */
export enum McpServerTransport
{
  StreamableHttp = "streamable-http",
  ServerSentEvents = "sse",
  WebSocket = "websocket",
}

/**
 * Rollout state of a registered MCP server, as shown to operators.
 *
 * Backend and UI use the same values, so neither side needs its own mapping. This is rollout
 * health only — it says nothing about whether a given user is entitled to the server, which is
 * {@link McpAccessPolicy}.
 */
export enum McpServerStatus
{
  Active = "active",
  Degraded = "degraded",
  Draft = "draft",
}

/**
 * On-behalf-of credential metadata linked to an MCP server. It names a credential; it never holds one.
 *
 * The opencrane-ui owns this inventory record; the runtime gateway plane may
 * be implemented by Obot, but it consumes the rendered catalog rather than
 * replacing this contract.
 */
export interface McpServerCredential
{
  /** Stable credential identifier. */
  id: string;
  /** Operator-facing label for the credential. */
  displayName: string;
}

/**
 * Shared contract for an MCP server exposed through the opencrane-ui API.
 *
 * The record represents OpenCrane's source-of-truth catalog entry: endpoint,
 * transport, grants, credentials, and rollout status. Downstream gateway
 * implementations such as Obot consume this opencrane-ui-managed inventory.
 */
export interface McpServer
{
  /** Stable server identifier. */
  id: string;
  /** Display name shown in the catalog. */
  name: string;
  /** Operator-facing summary of the server. */
  description: string;
  /** Upstream address or gateway-routable endpoint. */
  endpoint: string;
  /** Highest domain scope where the server is managed. */
  scope: GrantScope;
  /** Transport contract spoken by the server. */
  transport: McpServerTransport;
  /** Current rollout state. */
  status: McpServerStatus;
  /** Free-text capability labels shown to operators; they carry no access meaning. */
  capabilities: string[];
  /** Grants compiled for access decisions. */
  grants: Grant[];
  /** Credential metadata linked to the server. */
  credentials: McpServerCredential[];
  /** Optional source label when imported from another inventory. */
  sourceName?: string;
  /** Last successful sync timestamp in ISO-8601 form. */
  lastSyncedAt?: string;
}
