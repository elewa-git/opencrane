/**
 * Defines the browser authority, direct authority, forwarding targets, and scheme admitted by one
 * development listener. The authentication middleware compares requests with this whole tuple so
 * Tier 2 loopback HTTP and Tier 3 ingress HTTPS cannot silently accept each other's origins.
 */
export interface DevelopmentAuthenticationTransport
{
	/** Direct authority presented to the application after trusted proxy handling. */
	readonly directHost: string;
	/** Browser-facing authority accepted through the optional proxy target. */
	readonly browserHost: string;
	/** Proxy authorities allowed to forward the browser host. */
	readonly proxyTargets: ReadonlySet<string>;
	/** Scheme used by the direct origin and, by default, the forwarded browser origin. */
	readonly scheme: "http" | "https";
	/** Browser scheme when a private Codespaces proxy terminates HTTPS before the local listener. */
	readonly browserScheme?: "http" | "https";
}
