/** Release-owned custody and identity settings for server-executed remote MCP calls. */
export interface OpenCraneMcpConnectionConfig
{
	/** Namespace that contains only this release's MCP connection credential Secrets. */
	readonly credentialNamespace: string;
	/** Absolute path of the dedicated server-only HMAC keyring. */
	readonly materialKeyringPath: string;
	/** Namespace in which the server's ServiceAccount and Pod run. */
	readonly serverNamespace: string;
	/** Pod UID supplied through the downward API and checked against TokenReview. */
	readonly serverPodUid: string;
	/** Exact ServiceAccount whose projected identity may claim remote MCP calls. */
	readonly serverServiceAccountName: string;
	/** Absolute path of the rotating projected token for the MCP server audience. */
	readonly tokenPath: string;
}
