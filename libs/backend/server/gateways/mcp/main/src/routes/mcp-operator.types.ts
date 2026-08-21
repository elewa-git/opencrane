/** Request body for authoring a per-user credential (write-only). */
export interface McpCredentialRequest
{
  /** Field values keyed by {@link CredentialField.key}; stored server-side only, never returned. */
  values: Record<string, string>;
}
