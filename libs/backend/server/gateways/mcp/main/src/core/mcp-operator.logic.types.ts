/**
 * Local identity used for MCP authorization decisions.
 *
 * The router resolves this identity from the authenticated OIDC issuer and subject plus the
 * trusted silo. It never copies OIDC group claims into the decision input.
 */
export interface McpOperatorCaller
{
  /** Stable local Principal identifier used by grant subjects and personal boundaries. */
  principalId: string;
  /** Silo derived from the trusted request host. */
  siloId: string;
}

/** Validated command that installs one catalogue server for the caller. */
export interface McpInstallCommand
{
  /** Stable catalogue server identifier. */
  serverId: string;
}

/** Validated command that changes whether one server is published. */
export interface McpEnabledCommand
{
  /** True publishes the server; false disables it. */
  enabled: boolean;
}

/** Validated command that replaces the MCP access-editor grant set. */
export interface McpAccessPolicyCommand
{
  /** Stable local Group identifiers that receive group-subject grants. */
  groupIds: string[];
  /** Stable local Principal identifiers that receive principal-subject grants. */
  principalIds: string[];
}
