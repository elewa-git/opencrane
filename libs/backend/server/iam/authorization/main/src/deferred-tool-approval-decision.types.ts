import type { JsonValue } from "@opencrane/util";

/** Terminal decision a reviewer may record for a deferred tool request. */
export enum DeferredToolDecisionKinds
{
	/** Approves the exact complete argument object carried by the decision request. */
	Approved = "approved",
	/** Refuses the proposed tool invocation without creating resume authority. */
	Denied = "denied",
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
	| { readonly outcome: "approved"; readonly argumentsDigest: string }
	| { readonly outcome: "denied" }
	| { readonly outcome: "expired" }
	| { readonly outcome: "already_decided"; readonly decision: DeferredToolDecisionKinds; readonly argumentsDigest?: string }
	| { readonly outcome: "invalid_arguments" }
	| { readonly outcome: "conflict" };
