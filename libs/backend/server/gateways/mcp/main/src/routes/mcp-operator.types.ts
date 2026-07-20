/** Request body for installing a catalogue server for the calling user. */
export interface McpInstallRequest
{
  /** Identifier of the catalogue server to install. */
  serverId: string;
}

/** Request body for authoring a per-user credential (write-only). */
export interface McpCredentialRequest
{
  /** Field values keyed by {@link CredentialField.key}; stored server-side only, never returned. */
  values: Record<string, string>;
}

/** Request body for the admin enable/disable toggle. */
export interface McpEnabledRequest
{
  /** True publishes the server; false disables it. */
  enabled: boolean;
}

/** Request body for replacing a server's access policy (admin). */
export interface McpAccessPolicyRequest
{
  /** When true, every caller in the org is entitled (lists ignored). */
  everyoneInOrg: boolean;
  /** Entitled group identifiers / names. */
  groups: string[];
  /** Entitled user identifiers. */
  users: string[];
}
