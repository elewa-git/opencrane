import type { UpgradeSessionProposalRepository } from "@opencrane/backend/agents/personal/configuration";
import type { Logger } from "@opencrane/backend/observability";

import type { ExternalActionApprovalOpener, ExternalActionExecutionContextLoader, ExternalActionWorkerEventSink, ExternalActionWorkerUnitOfWork, ToolInvocationWorkSource } from "./external-action-worker.types.js";
import type { ProductionExternalActionTransports } from "./external-action-executor.types.js";

/** One port that both finds runnable invocations and writes their state. */
export type ProductionExternalActionInvocationAuthority = ExternalActionWorkerUnitOfWork & ToolInvocationWorkSource;

/** What the process composition root passes to the worker factory. */
export interface ProductionExternalActionWorkerDependencies
{
	/** Finds runnable invocations, and writes claims, recoveries, and completions. */
	readonly invocations: ProductionExternalActionInvocationAuthority;
	/** Loads the run's frozen snapshot; implemented in this package. */
	readonly contexts: ExternalActionExecutionContextLoader;
	/** Saves tool lifecycle events. */
	readonly events: ExternalActionWorkerEventSink;
	/** Existing server-owned integration, sandbox, and memory transports. */
	readonly transports: ProductionExternalActionTransports;
	/** Opens approval requests. Wired separately from the provider adapter. */
	readonly approvals: ExternalActionApprovalOpener;
	/** Writes upgrade-session proposals for the built-in personal configuration tool. */
	readonly personalConfiguration: UpgradeSessionProposalRepository;
	/** Structured logger. Never log credentials to it. */
	readonly log: Logger;
}
