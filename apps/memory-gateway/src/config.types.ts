/** Fully validated private memory-gateway process configuration. */
export interface MemoryGatewayProcessConfig
{
	/** Private listener port. */
	readonly port: number;
	/** Release-local private Cognee origin. */
	readonly cogneeUrl: string;
	/** Namespace that owns both the server and this gateway. */
	readonly namespace: string;
	/** Exact service account identity allowed to use this gateway. */
	readonly serverServiceAccountName: string;
	/** Audience expected on the server's projected token. */
	readonly serverTokenAudience: string;
	/** Per-hop HTTP timeout. */
	readonly requestTimeoutMilliseconds: number;
}
