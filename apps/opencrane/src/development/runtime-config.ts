import { LOCAL_DEVELOPMENT_RUNTIME_IDENTITIES } from "@opencrane/models/local-development";

import type { DevelopmentRuntimeConfig } from "./runtime-config.types";

/** Build inert runtime coordinates for core, and the shared local coordinates used by Agent profiles. */
export function _CreateDevelopmentRuntimeConfig(): DevelopmentRuntimeConfig
{
	return {
		assignmentTtlMilliseconds: 3_600_000,
		claimLeaseMilliseconds: 30_000,
		commandRecoveryMilliseconds: 5_000,
		commandTtlMilliseconds: 60_000,
		managedRuntimeNamespace: LOCAL_DEVELOPMENT_RUNTIME_IDENTITIES.managed.namespace,
		outboxPruneBatchSize: 100,
		personalRuntimeNamespace: LOCAL_DEVELOPMENT_RUNTIME_IDENTITIES.personal.namespace,
		publishedOutboxRetentionMilliseconds: 604_800_000,
		serverNamespace: LOCAL_DEVELOPMENT_RUNTIME_IDENTITIES.serverNamespace,
	};
}
