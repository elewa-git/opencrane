/** Fixed trusted-host coordinates selected only from deployment configuration. */
export interface ExactHostSiloConfig
{
	/** Exact lower-case public host admitted by this resolver. */
	readonly trustedHost: string;
	/** Silo selected when the exact host matches. */
	readonly siloId: string;
}
