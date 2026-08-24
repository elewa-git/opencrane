import type { PrismaClient } from "@prisma/client";

import { PrismaRunCancellationRepository, type RunCancellationRepository } from "@opencrane/backend/agents/execution/runs";

import type { RunCancellationRuntimeConfig } from "./config.types";

/** How long a cleanup claim stays valid before another pass may reclaim it; the repair and cleanup passes share this value. */
const _RUNTIME_CLEANUP_CLAIM_LEASE_MILLISECONDS = 30_000;

/** Extra time after a dispatch lease in which an in-flight Kubernetes Job create may still finish, so a Job that is not visible yet is not treated as an orphan. */
const _RUNTIME_ORPHAN_OBSERVATION_MARGIN_MILLISECONDS = 10_000;

/** Compose one cancellation authority shared by the public route and cleanup workers. */
export function _CreateRunCancellationAuthority(prisma: PrismaClient, config: RunCancellationRuntimeConfig): RunCancellationRepository
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
