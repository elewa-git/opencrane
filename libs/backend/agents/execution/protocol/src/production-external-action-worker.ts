import { TOOL_INVOCATION_PREPARATION_POLICY } from "@opencrane/backend/server/iam/authorization";

import { ExternalActionWorker } from "./external-action-worker.js";
import { ProductionExternalActionAdapterFactory } from "./production-external-action-adapter.js";
import type { ProductionExternalActionWorkerDependencies } from "./production-external-action-worker.types.js";

/**
 * Build the worker with its fixed preparation limits: at most three attempts in five minutes.
 *
 * The one place those limits are chosen, taken from `TOOL_INVOCATION_PREPARATION_POLICY` so the
 * worker and the state authority that counts attempts cannot disagree. The provider claim lease is
 * 30 seconds: long enough for a call, short enough that a crashed worker's invocation is picked up
 * again quickly.
 *
 * Called by: `_CreateExternalActionWorker` in apps/opencrane/src/app/external-action-composition.ts.
 *
 * @param dependencies - The ports and transports the app composition root owns.
 * @returns A worker ready to be driven by an interval.
 * @see ExternalActionWorkerPolicy
 */
export function __CreateProductionExternalActionWorker(dependencies: ProductionExternalActionWorkerDependencies): ExternalActionWorker
{
	return new ExternalActionWorker({
		source: dependencies.invocations,
		invocations: dependencies.invocations,
		contexts: dependencies.contexts,
		events: dependencies.events,
		adapters: new ProductionExternalActionAdapterFactory({ transports: dependencies.transports, personalConfiguration: dependencies.personalConfiguration, personalMemoryPermissions: dependencies.personalMemoryPermissions, now: function _now() { return new Date(); } }),
		approvals: dependencies.approvals,
		personalMemoryPermissions: dependencies.personalMemoryPermissions,
		clock: { now: function _now() { return new Date(); } },
		policy: { preparationAttemptLimit: TOOL_INVOCATION_PREPARATION_POLICY.attemptLimit, preparationRetryWindowMilliseconds: TOOL_INVOCATION_PREPARATION_POLICY.retryWindowMilliseconds, preparationRetryDelayMilliseconds: TOOL_INVOCATION_PREPARATION_POLICY.retryDelayMilliseconds, providerClaimLeaseMilliseconds: 30_000 },
		log: dependencies.log,
	});
}
