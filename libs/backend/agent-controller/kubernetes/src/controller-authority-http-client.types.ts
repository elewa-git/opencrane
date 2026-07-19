/** Closed configuration for the controller's private OpenCrane authority client. */
export interface ControllerAuthorityHttpClientOptions
{
	/** Private OpenCrane internal-listener base URL. */
	readonly baseUrl: string;
	/** Separate projected ServiceAccount token accepted only by OpenCrane. */
	readonly tokenPath: string;
	/** Injectable transport for deterministic adapter tests. */
	readonly fetch: typeof globalThis.fetch;
}
