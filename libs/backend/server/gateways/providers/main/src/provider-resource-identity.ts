/**
 * Returns the provider-connection id shared by BYOK commands, credential storage, grants, and runs.
 *
 * Silo ownership remains a separate database and authorization coordinate, so the same provider
 * name can safely exist in different silos without creating another identity format.
 *
 * Called by: BYOK routes, provider-effect projection, and model-registration blocker checks.
 *
 * @param siloId - Silo that owns the provider connection and its globally unique database row.
 * @param provider - Normalized external provider name.
 * @returns The stable id used for the silo-global provider connection.
 */
export function _ByokProviderConnectionId(siloId: string, provider: string): string
{
	return `byok:${siloId}:${provider}`;
}
