import type { TrustedHostSiloBinding, TrustedHostSiloPort } from "./channel-target-resolution.types";
import type { ExactHostSiloConfig } from "./exact-host-silo.types";

/** Exact deployment-owned host-to-silo authority. */
export class __ExactHostSiloResolver implements TrustedHostSiloPort
{
	/** Validated host and silo coordinates. */
	private readonly config: ExactHostSiloConfig;

	/** Creates one exact host registration and rejects an incomplete deployment binding. */
	constructor(config: ExactHostSiloConfig)
	{
		if (!config.trustedHost.trim() || config.trustedHost !== config.trustedHost.toLowerCase() || !config.siloId.trim()) throw new Error("trusted channel host and silo must be configured");
		this.config = config;
	}

	/** Resolves only the registered host to its silo. */
	async resolveExactHost(trustedHost: string): Promise<TrustedHostSiloBinding | null>
	{
		return trustedHost === this.config.trustedHost
			? { siloId: this.config.siloId }
			: null;
	}
}
