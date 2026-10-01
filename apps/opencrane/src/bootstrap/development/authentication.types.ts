/**
 * Defines the browser authority, direct authority, forwarding targets, and scheme admitted by one
 * development listener. The authentication boundary compares requests with this complete tuple.
 */
export interface DevelopmentAuthenticationTransport
{
	/** Direct authority accepted without a browser proxy. */
	readonly directHost: string;
	/** Browser-facing authority accepted through an approved proxy target. */
	readonly browserHost: string;
	/** Internal authorities allowed to receive a request forwarded for the browser host. */
	readonly proxyTargets: ReadonlySet<string>;
	/** Scheme used by the direct origin and internal development listener. */
	readonly scheme: "http" | "https";
	/** Browser scheme when a private proxy terminates HTTPS before the local listener. */
	readonly browserScheme?: "http" | "https";
}
