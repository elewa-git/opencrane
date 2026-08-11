import type { JsonValue } from "@opencrane/util";

/** Terminal decision a reviewer may record for a deferred tool request. */
export enum DeferredToolDecisionKinds
{
	/** Approves the exact complete argument object carried by the decision request. */
	Approved = "approved",
	/** Refuses the proposed tool invocation without creating resume authority. */
	Denied = "denied",
}

/** Stable result vocabulary for one transaction-bound deferred-tool decision. */
export enum DeferredToolDecisionOutcomes
{
	/** The reviewed arguments were accepted. */
	Approved = "approved",
	/** The reviewer refused the action. */
	Denied = "denied",
	/** The decision window closed before this answer. */
	Expired = "expired",
	/** The same terminal decision was already durable. */
	AlreadyDecided = "already_decided",
	/** Replacement arguments failed the reviewed schema. */
	InvalidArguments = "invalid_arguments",
	/** Durable authority disagreed with this decision request. */
	Conflict = "conflict",
}

/** Exact pending deferred-tool request being decided at a trusted server instant. */
export interface DecideDeferredToolRequestCommand
{
	/** Interrupt id that is also the durable ApprovalRequest primary key. */
	readonly approvalRequestId: string;
	/** Silo the authenticated reviewer is operating within. */
	readonly siloId: string;
	/** Authenticated subject that owns the approval-bound runtime action. */
	readonly subjectId: string;
	/** Reviewer's terminal decision. */
	readonly decision: DeferredToolDecisionKinds;
	/** Complete replacement arguments required for approval and forbidden for denial. */
	readonly arguments?: JsonValue;
	/** Subject who recorded the decision. */
	readonly decidedBy: string;
	/** Trusted decision instant. */
	readonly now: Date;
}

/** Trusted attempt coordinates used by runtime dispatch to close due approvals. */
export interface ExpireDeferredToolApprovalBatchCommand
{
	/** Exact run whose command poll owns the expiry sweep transaction. */
	readonly runId: string;
	/** Exact current attempt whose waiting state is fenced by the transaction. */
	readonly attempt: number;
	/** Trusted server instant used to select requests at or beyond their deadline. */
	readonly now: Date;
}

/** Durable outcome of one expiry sweep under the run's approval fence. */
export interface ExpireDeferredToolApprovalBatchResult
{
	/** Number of pending requests moved to Expired by this sweep. */
	readonly expiredCount: number;
	/** Whether the last pending request resolved and the run returned to Running. */
	readonly resumed: boolean;
}

/** Result of atomically deciding one pending deferred tool request. */
export type DecideDeferredToolRequestResult =
	| { readonly outcome: DeferredToolDecisionOutcomes.Approved; readonly argumentsDigest: string }
	| { readonly outcome: DeferredToolDecisionOutcomes.Denied }
	| { readonly outcome: DeferredToolDecisionOutcomes.Expired }
	| { readonly outcome: DeferredToolDecisionOutcomes.AlreadyDecided; readonly decision: DeferredToolDecisionKinds; readonly argumentsDigest?: string }
	| { readonly outcome: DeferredToolDecisionOutcomes.InvalidArguments }
	| { readonly outcome: DeferredToolDecisionOutcomes.Conflict };
