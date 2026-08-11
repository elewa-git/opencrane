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
		clock: { now: function _now() { return new Date(); } },
		policy: { preparationAttemptLimit: 3, preparationRetryWindowMilliseconds: 300_000, preparationRetryDelayMilliseconds: 1_000, providerClaimLeaseMilliseconds: 30_000 },
		log: dependencies.log,
	});
}
