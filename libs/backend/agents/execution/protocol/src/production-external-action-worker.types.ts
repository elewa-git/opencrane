import type { UpgradeSessionProposalRepository } from "@opencrane/backend/agents/personal/configuration";
import type { Logger } from "@opencrane/backend/observability";

import type { ExternalActionApprovalOpener, ExternalActionExecutionContextLoader, ExternalActionWorkerEventSink, ExternalActionWorkerUnitOfWork, ToolInvocationWorkSource } from "./external-action-worker.types.js";
import type { ProductionExternalActionTransports } from "./external-action-executor.types.js";

/** Combined persistence authority required by the process worker. */
export type ProductionExternalActionInvocationAuthority = ExternalActionWorkerUnitOfWork & ToolInvocationWorkSource;

/** Dependencies supplied by the thin OpenCrane process composition root. */
export interface ProductionExternalActionWorkerDependencies
{
	/** ToolInvocation-owned runnable work, claims, recovery, and completion authority. */
	readonly invocations: ProductionExternalActionInvocationAuthority;
	/** Canonical immutable snapshot loader owned by the execution protocol package. */
	readonly contexts: ExternalActionExecutionContextLoader;
	/** Canonical server-owned tool lifecycle event sink. */
	readonly events: ExternalActionWorkerEventSink;
	/** Existing server-owned integration, sandbox, and memory transports. */
	readonly transports: ProductionExternalActionTransports;
	/** Server-owned deferred approval authority composed outside the provider adapter. */
	readonly approvals: ExternalActionApprovalOpener;
	/** Built-in personal configuration proposal authority. */
	readonly personalConfiguration: UpgradeSessionProposalRepository;
	/** Structured credential-free evidence sink. */
	readonly log: Logger;
}
