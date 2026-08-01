import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";

import { __CreateRuntimeWorkloadCleanupUseCase, PrismaRunCancellationRepository } from "@opencrane/backend/agents/execution/runs";
import { __CreateKubernetesRuntimeWorkloadCleanupStore } from "@opencrane/backend/agents/runtime/cleanup";
import type { ManagedRunAdmissionPort } from "@opencrane/backend/server/agents/agent-services";
import { _CreateScheduleTicker } from "@opencrane/backend/server/agents/scheduling";

import type { OpenCraneBackgroundWorkers } from "./background-workers.types.js";
import type { OpenCraneProcessConfig } from "./config.types.js";
import { _log } from "./log.js";

/** Delay between checks for a runtime attempt whose signed workload lease expired. */
const _RUNTIME_REPAIR_INTERVAL_MILLISECONDS = 30_000;

/** Delay between database-fenced runtime workload cleanup claims. */
const _RUNTIME_CLEANUP_INTERVAL_MILLISECONDS = 5_000;

/** Hard deadline for one Kubernetes Job read or conditional deletion. */
const _RUNTIME_CLEANUP_REQUEST_TIMEOUT_MILLISECONDS = 5_000;

/** Database claim lifetime shared by repair and cleanup passes. */
const _RUNTIME_CLEANUP_CLAIM_LEASE_MILLISECONDS = 30_000;

/** Margin that separates two observations of an unassigned orphan's absence. */
const _RUNTIME_ORPHAN_OBSERVATION_MARGIN_MILLISECONDS = 10_000;

/**
 * Start all bounded workers that intentionally share the control-plane database and identity.
 *
 * The returned stop handle is the lifecycle boundary: every loop must be stopped before Prisma is
 * disconnected, and none may keep the Node process alive on its own.
 */
export function _StartBackgroundWorkers(prisma: PrismaClient, batchApi: k8s.BatchV1Api, managedRunAdmission: ManagedRunAdmissionPort, config: OpenCraneProcessConfig): OpenCraneBackgroundWorkers
{
	// 1. Start optional schedule admission through the same capacity port used by run-now requests.
	const scheduleTicker = _CreateScheduleTicker(prisma, managedRunAdmission, _log);
	const schedulerHandle = config.schedulerEnabled
		? setInterval(function _tick() { void scheduleTicker.runOnce(new Date()).catch(function _onError(error: unknown) { _log.error({ err: error }, "managed-agent schedule tick failed"); }); }, config.schedulerIntervalMilliseconds)
		: null;
	schedulerHandle?.unref();

	// 2. Validate the two untrusted runtime planes before granting the repair repository authority.
	if (!config.runtime.personalRuntimeNamespace || !config.runtime.managedRuntimeNamespace || config.runtime.personalRuntimeNamespace === config.runtime.managedRuntimeNamespace)
	{
		throw new Error("distinct personal and managed runtime namespaces must be configured for runtime repair");
	}
	const runtimeRepairRepository = new PrismaRunCancellationRepository(prisma, {
		personalRuntimeNamespace: config.runtime.personalRuntimeNamespace,
		managedRuntimeNamespace: config.runtime.managedRuntimeNamespace,
		claimLeaseMilliseconds: _RUNTIME_CLEANUP_CLAIM_LEASE_MILLISECONDS,
		orphanObservationMarginMilliseconds: _RUNTIME_ORPHAN_OBSERVATION_MARGIN_MILLISECONDS,
	});
	const runtimeCleanupShutdown = new AbortController();
	const runtimeCleanup = __CreateRuntimeWorkloadCleanupUseCase({
		repository: runtimeRepairRepository,
		store: __CreateKubernetesRuntimeWorkloadCleanupStore({
			batchApi,
			requestTimeoutMilliseconds: _RUNTIME_CLEANUP_REQUEST_TIMEOUT_MILLISECONDS,
			shutdownSignal: runtimeCleanupShutdown.signal,
		}),
	});

	// 3. Run durable terminal repair separately from physical Job cleanup and fence both in Postgres.
	const runtimeRepairHandle = setInterval(function _repair() { void runtimeRepairRepository.repairNextExpiredRunAtomically().catch(function _onError(error: unknown) { _log.error({ err: error }, "runtime terminal repair failed"); }); }, _RUNTIME_REPAIR_INTERVAL_MILLISECONDS);
	runtimeRepairHandle.unref();
	const runtimeCleanupHandle = setInterval(function _cleanup() { void runtimeCleanup.reconcileNext().catch(function _onError(error: unknown) { _log.error({ err: error }, "runtime workload cleanup failed"); }); }, _RUNTIME_CLEANUP_INTERVAL_MILLISECONDS);
	runtimeCleanupHandle.unref();

	return {
		async stop(): Promise<void>
		{
			if (schedulerHandle !== null) clearInterval(schedulerHandle);
			clearInterval(runtimeRepairHandle);
			clearInterval(runtimeCleanupHandle);
			runtimeCleanupShutdown.abort();
			await runtimeCleanup.drain();
		},
	};
}
