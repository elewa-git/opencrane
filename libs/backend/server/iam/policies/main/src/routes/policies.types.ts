/**
 * API types for the access-policy routes.
 */

/** Request body for creating a new access policy. */
export interface CreatePolicyRequest
{
  /** Unique policy name. */
  name: string;
  /** Optional human-readable description. */
  description?: string;
  /** Selector that determines which tenants the policy applies to. */
  tenantSelector?: {
    /** Label key/value pairs to match. */
    matchLabels?: Record<string, string>;
    /** Team name to match. */
    matchTeam?: string;
  };
  /** Domain-level network restrictions. */
  domains?: {
    /** Allowed domain patterns. */
    allow?: string[];
    /** Denied domain patterns. */
    deny?: string[];
    /** Whether to deny all domains not explicitly allowed. */
    defaultDeny?: boolean;
  };
  /** Low-level egress CIDR rules. */
  egressRules?: Array<{
    /** CIDR block (e.g. "10.0.0.0/8"). */
    cidr: string;
    /** Allowed destination ports. */
    ports?: number[];
    /** Transport protocol. */
    protocol?: "TCP" | "UDP";
  }>;
  /** MCP server access restrictions. */
  mcpServers?: {
    /** Allowed MCP server names. */
    allow?: string[];
    /** Denied MCP server names. */
    deny?: string[];
  };
}
