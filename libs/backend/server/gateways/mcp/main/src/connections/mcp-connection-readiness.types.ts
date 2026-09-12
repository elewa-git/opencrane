/** Coordinates that bind one MCP tool to the Principal whose installation may authorize dispatch. */
export interface McpConnectionReadinessCommand
{
	/** Silo containing the tool, server and installation. */
	readonly siloId: string;
	/** Immutable tool revision selected for this effect. */
	readonly toolRevisionId: string;
	/** Personal or managed-service Principal that will perform the effect. */
	readonly ownerPrincipalId: string;
}

/** Reads and claims the current credentialless installation for one exact MCP effect. */
export interface McpConnectionReadiness
{
	/** Return true only while the exact owner has a credentialless install on a usable server. */
	isReady(command: McpConnectionReadinessCommand): Promise<boolean>;
	/** Lock the exact credentialless install against uninstall before provider dispatch is claimed. */
	lockForDispatch(command: McpConnectionReadinessCommand): Promise<boolean>;
}
