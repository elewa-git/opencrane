import type { UpgradeSessionProposalRepository } from "@opencrane/backend/agents/personal/configuration";
import type { OpenDeferredToolApprovalCommand, ToolInvocationRepository } from "@opencrane/backend/server/iam/authorization";
import type { Logger } from "@opencrane/backend/observability";

import type { ExternalActionExecutorDependencies } from "./external-action-executor.types.js";

/** External transports shared by every action while run-specific authority stays on the snapshot. */
export type ProductionExternalActionTransports = Omit<ExternalActionExecutorDependencies, "siloId" | "subjectId" | "cogneeDatasetId" | "agentRevisionId">;

/** Trusted wall clock used for upgrade proposals and deferred-approval expiry. */
export interface ProductionExternalActionClock
{
	/** Returns the server instant for one policy decision. */
	now(): Date;
}

/** Durable boundary that opens approval only for an already-reserved invocation. */
export interface ProductionDeferredApprovalOpener
{
	/** Opens or idempotently resolves one exact deferred invocation reservation. */
	open(command: OpenDeferredToolApprovalCommand): Promise<boolean>;
}

/** Authorities and transports required by the production external-action runner. */
export interface ProductionExternalActionRunnerDependencies
{
	/** Durable reserve-before-I/O invocation authority. */
	readonly invocations: ToolInvocationRepository;
	/** Personal configuration authority behind the first-party upgrade-session tool. */
	readonly personalConfiguration: UpgradeSessionProposalRepository;
	/** Credential-free third-party and isolated execution transports. */
	readonly transports: ProductionExternalActionTransports;
	/** Approval authority used only after a deferred invocation reservation exists. */
	readonly approvals: ProductionDeferredApprovalOpener;
	/** Trusted server clock for proposal and approval lifetimes. */
	readonly clock: ProductionExternalActionClock;
	/** Structured evidence sink for bounded execution failures. */
	readonly log: Logger;
}
