/** Fully validated private memory-gateway process configuration. */
export interface MemoryGatewayProcessConfig
{
	/** Private listener port. */
	readonly port: number;
	/** Release-local private Cognee origin. */
	readonly cogneeUrl: string;
	/** Mounted Secret file containing the per-silo Cognee service-user email. */
	readonly cogneeCredentialEmailPath: string;
	/** Mounted Secret file containing the per-silo Cognee service-user password. */
	readonly cogneeCredentialPasswordPath: string;
	/** Whether this process may register the configured user after its first rejected login. */
	readonly allowFirstInstallRegistration: boolean;
	/** Namespace that owns both the server and this gateway. */
	readonly namespace: string;
	/** Exact service account identity allowed to use this gateway. */
	readonly serverServiceAccountName: string;
	/** Audience expected on the server's projected token. */
	readonly serverTokenAudience: string;
	/** Timeout applied separately to each HTTP call the gateway makes. */
	readonly requestTimeoutMilliseconds: number;
}
