import type { PrismaClient } from "@prisma/client";

import { PrismaRunCancellationRepository, type RunCancellationRepository } from "@opencrane/backend/agents/execution/runs";

import type { InternalRuntimeConfig } from "./config.types";

/** How long a cleanup claim stays valid before another cleanup pass may reclaim it. */
const _RUNTIME_CLEANUP_CLAIM_LEASE_MILLISECONDS = 30_000;

/** Waits past a workflow task's possible Job creation before cleanup first treats an unbound Job as absent. */
export const _RUNTIME_ORPHAN_OBSERVATION_MARGIN_MILLISECONDS = 10_000;

/** Compose one cancellation authority shared by the public route and cleanup workers. */
export function _CreateRunCancellationAuthority(prisma: PrismaClient, config: InternalRuntimeConfig): RunCancellationRepository
{
	if (!config.personalRuntimeNamespace || !config.managedRuntimeNamespace || config.personalRuntimeNamespace === config.managedRuntimeNamespace)
	{
		throw new Error("distinct personal and managed runtime namespaces must be configured for run cancellation");
	}
	return new PrismaRunCancellationRepository(prisma, {
		personalRuntimeNamespace: config.personalRuntimeNamespace,
		managedRuntimeNamespace: config.managedRuntimeNamespace,
		claimLeaseMilliseconds: _RUNTIME_CLEANUP_CLAIM_LEASE_MILLISECONDS,
		orphanObservationMarginMilliseconds: _RUNTIME_ORPHAN_OBSERVATION_MARGIN_MILLISECONDS,
	});
}
