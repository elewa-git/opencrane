import type { Request } from "express";

import type { Logger } from "@opencrane/backend/observability";

import type { DeferredToolApprovalDecisionRepository } from "./deferred-tool-approval-decision.types.js";
import type { SelfDeferredToolApprovalReadUnitOfWork } from "./deferred-tool-approval-interrupt.types.js";

/** Authenticated browser caller resolved by the composing server, never from request input. */
export interface DeferredToolApprovalCaller
{
	/** Silo resolved from the authenticated request host. */
	readonly siloId: string;
	/** Stable identity-provider subject who owns the pending runtime action. */
	readonly subjectId: string;
}

/** Trusted clock injected for deterministic approval-decision tests. */
export interface DeferredToolApprovalClock
{
	/** Return the server's current decision time. */
	now(): Date;
}

/** Composition ports for the self-only deferred-tool approval decision API. */
export interface DeferredToolApprovalRouterDependencies
{
	/** Resolves session and host identity, or null when no authenticated caller exists. */
	resolveCaller(request: Request): DeferredToolApprovalCaller | null;
	/** Records the decision in one transaction, and only if the stored approval belongs to this caller. */
	readonly decisions: DeferredToolApprovalDecisionRepository;
	/** Lists only the pending approvals owned by the browser caller. */
	readonly pendingApprovals: SelfDeferredToolApprovalReadUnitOfWork;
	/** Supplies trusted server timestamps. */
	readonly clock: DeferredToolApprovalClock;
	/** Records unexpected persistence failures without logging approval payloads or tokens. */
	readonly logger: Logger;
}
