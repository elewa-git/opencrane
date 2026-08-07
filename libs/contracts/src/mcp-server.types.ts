import type { Grant } from "./grant.types.js";
import { GrantScope } from "./grant.types.js";

/**
 * Transport contract exposed by an MCP server registration.
 *
 * MCP refers to the Model Context Protocol: https://modelcontextprotocol.io/introduction
 * OpenCrane stores these values centrally so the opencrane-ui can describe
 * what the gateway plane should broker on behalf of tenants.
 */
export enum McpServerTransport
{
  StreamableHttp = "streamable-http",
  ServerSentEvents = "sse",
  WebSocket = "websocket",
}

/**
 * Lifecycle state shown for a registered MCP server.
 *
 * The UI uses this to summarize rollout health, while the backend emits the
 * exact same values from the opencrane-ui inventory APIs.
 */
export enum McpServerStatus
{
  Active = "active",
  Degraded = "degraded",
  Draft = "draft",
}

/**
 * OBO credential metadata linked to an MCP server.
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
  /** Capability labels surfaced to operators. */
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
