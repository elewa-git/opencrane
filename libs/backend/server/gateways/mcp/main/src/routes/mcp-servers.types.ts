/** Supported organizational scopes for MCP server inventory. */
export type McpServerRouteScope = "org" | "department" | "project" | "personal";

/** Supported transport modes for MCP endpoints. */
export type McpServerRouteTransport = "streamable-http" | "sse" | "websocket";

/** Supported rollout states for MCP servers. */
export type McpServerRouteStatus = "active" | "degraded" | "draft";

/** Request body used to create or update a dedicated MCP credential record. */
export interface McpServerCredentialInput
{
  /** Operator-facing label for the credential. */
  displayName: string;
}

/** Request body used to create or update an MCP server. */
export interface McpServerWriteRequest
{
  /** Display name shown in the MCP catalog. */
  name: string;
  /** Short operator-facing summary. */
  description?: string;
  /** Gateway endpoint or upstream address. */
  endpoint: string;
  /** Primary organizational scope for the server. */
  scope: McpServerRouteScope;
  /** Transport contract used by the server. */
  transport: McpServerRouteTransport;
  /** Current rollout status. */
  status?: McpServerRouteStatus;
  /** Capability labels surfaced in the UI. */
  capabilities?: string[];
  /** Optional upstream source identifier. */
  sourceId?: string;
  /** Optional sync timestamp. */
  lastSyncedAt?: string;
  /** Credential metadata owned by the future gateway broker. */
  credentials?: McpServerCredentialInput[];
}
