import { TOOL_INVOCATION_PREPARATION_POLICY } from "@opencrane/backend/server/iam/authorization";

import { ExternalActionWorker } from "./external-action-worker.js";
import { ProductionExternalActionAdapterFactory } from "./production-external-action-adapter.js";
import type { ProductionExternalActionWorkerDependencies } from "./production-external-action-worker.types.js";

/** Construct the durable process worker with fixed three-in-five-minutes preparation policy. */
export function __CreateProductionExternalActionWorker(dependencies: ProductionExternalActionWorkerDependencies): ExternalActionWorker
{
	return new ExternalActionWorker({
		source: dependencies.invocations,
		invocations: dependencies.invocations,
		contexts: dependencies.contexts,
		events: dependencies.events,
		adapters: new ProductionExternalActionAdapterFactory({ transports: dependencies.transports, personalConfiguration: dependencies.personalConfiguration, now: function _now() { return new Date(); } }),
		approvals: dependencies.approvals,
		clock: { now: function _now() { return new Date(); } },
		policy: { preparationAttemptLimit: TOOL_INVOCATION_PREPARATION_POLICY.attemptLimit, preparationRetryWindowMilliseconds: TOOL_INVOCATION_PREPARATION_POLICY.retryWindowMilliseconds, preparationRetryDelayMilliseconds: TOOL_INVOCATION_PREPARATION_POLICY.retryDelayMilliseconds, providerClaimLeaseMilliseconds: 30_000 },
		log: dependencies.log,
	});
}
