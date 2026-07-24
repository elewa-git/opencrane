/** Active personal member derived from an authenticated browser session and exact host silo. */
export interface ActivePersonalCaller
{
	/** Stable subject supplied by the verified OIDC session. */
	readonly userId: string;
	/** Exact ClusterTenant silo derived from the request host. */
	readonly siloId: string;
}
