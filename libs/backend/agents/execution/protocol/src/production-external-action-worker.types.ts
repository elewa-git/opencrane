import type { UpgradeSessionProposalRepository } from "@opencrane/backend/agents/personal/configuration";
import type { PersonalMemoryPermissionAuthority } from "@opencrane/backend/agents/execution/elicitation";
import type { Logger } from "@opencrane/backend/observability";

import type { ExternalActionApprovalOpener, ExternalActionClassAdmission, ExternalActionExecutionContextLoader, ExternalActionWorkerEventSink, ExternalActionWorkerUnitOfWork, ToolInvocationWorkSource } from "./external-action-worker.types";
import type { ProductionExternalActionTransports } from "./external-action-executor.types";

/** One port that both finds runnable invocations and writes their state. */
export type ProductionExternalActionInvocationAuthority = ExternalActionWorkerUnitOfWork & ToolInvocationWorkSource;

/** What the process composition root passes to the worker factory. */
export interface ProductionExternalActionWorkerDependencies
{
	/** Finds runnable invocations, and writes claims, recoveries, and completions. */
	readonly invocations: ProductionExternalActionInvocationAuthority;
	/** Class-specific durable execution admission checked before generic provider dispatch. */
	readonly classAdmission: ExternalActionClassAdmission;
	/** Loads the run's frozen snapshot; implemented in this package. */
	readonly contexts: ExternalActionExecutionContextLoader;
	/** Saves tool lifecycle events. */
	readonly events: ExternalActionWorkerEventSink;
	/** Existing server-owned sandbox and memory transports. */
	readonly transports: ProductionExternalActionTransports;
	/** Opens approval requests. Wired separately from the provider adapter. */
	readonly approvals: ExternalActionApprovalOpener;
	/** Execution-user elicitation gate required before any personal-memory recall may proceed. */
	readonly personalMemoryPermissions: PersonalMemoryPermissionAuthority;
	/** Built-in personal configuration proposal authority. */
	readonly personalConfiguration: UpgradeSessionProposalRepository;
	/** Structured logger. Never log credentials to it. */
	readonly log: Logger;
}
