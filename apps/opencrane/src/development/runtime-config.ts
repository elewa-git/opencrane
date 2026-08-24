import type { DevelopmentRuntimeConfig } from "./runtime-config.types";

/** Build inert runtime coordinates for core, and the shared local coordinates used by Agent profiles. */
export function _CreateDevelopmentRuntimeConfig(): DevelopmentRuntimeConfig
{
	return {
		assignmentTtlMilliseconds: 3_600_000,
		claimLeaseMilliseconds: 30_000,
		commandRecoveryMilliseconds: 5_000,
		commandTtlMilliseconds: 60_000,
		managedRuntimeNamespace: "local-development-managed-runtime",
		outboxPruneBatchSize: 100,
		personalRuntimeNamespace: "local-development-personal-runtime",
		publishedOutboxRetentionMilliseconds: 604_800_000,
		serverNamespace: "local-development-server",
	};
}
