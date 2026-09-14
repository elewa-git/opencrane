/** Exact hosts and origins accepted by one explicitly composed development transport. */
export interface DevelopmentAuthenticationTransport
{
	/** Direct authority presented to the application after trusted proxy handling. */
	readonly directHost: string;
	/** Browser-facing authority accepted through the optional proxy target. */
	readonly browserHost: string;
	/** Proxy authorities allowed to forward the browser host. */
	readonly proxyTargets: ReadonlySet<string>;
	/** Scheme used by the exact direct and forwarded browser origins. */
	readonly scheme: "http" | "https";
}
