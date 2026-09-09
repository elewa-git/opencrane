import type { JsonValue } from "@opencrane/util";

/**
 * The two answers a reviewer can give, and they are final.
 *
 * `Approved` MUST come with a complete replacement argument object; a partial edit is rejected as
 * `invalid_arguments`, because merging a partial edit server-side would let a reviewer approve
 * values they never saw. `Denied` must come with no arguments at all.
 *
 * These string values are also the wire values on the decision route, so they cannot be renamed
 * without a client change.
 * @see {@link DecideDeferredToolRequestCommand}
 */
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
	/** Authenticated human subject that may review this approval. */
	readonly reviewerSubjectId: string;
	/** Reviewer's terminal decision. */
	readonly decision: DeferredToolDecisionKinds;
	/** Complete replacement arguments required for approval and forbidden for denial. */
	readonly arguments?: JsonValue;
	/** Subject who recorded the decision. */
	readonly decidedBy: string;
	/** Trusted decision instant. */
	readonly now: Date;
}

/**
 * Which run attempt to sweep for approvals whose deadline has passed.
 *
 * Sent by the runtime's own command poll, so the sweep happens on a transaction that already
 * holds the run, and no separate cron job is needed.
 */
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

/**
 * What the decision attempt actually did, and what the caller should tell the user.
 *
 * - `approved` / `denied` — the decision was recorded now.
 * - `already_decided` — the same decision was already recorded; safe to report as success. The
 *   caller's retry did nothing, which is the point.
 * - `expired` — the deadline had passed, so the request was closed instead of decided. The user
 *   must be told their answer was not applied.
 * - `invalid_arguments` — approval without a complete argument object, denial with arguments, or
 *   arguments that fail the frozen schema.
 * - `conflict` — the row is not what the caller thinks: wrong owner or silo, the run is no longer
 *   waiting, the earlier decision went the other way, or the stored data failed its integrity
 *   check. Never retry a `conflict`; re-read first.
 *
 * ./deferred-tool-approval.router.ts maps these to 200, 409, 400, and 404 respectively.
 */
export type DecideDeferredToolRequestResult =
	| { readonly outcome: DeferredToolDecisionOutcomes.Approved; readonly argumentsDigest: string }
	| { readonly outcome: DeferredToolDecisionOutcomes.Denied }
	| { readonly outcome: DeferredToolDecisionOutcomes.Expired }
	| { readonly outcome: DeferredToolDecisionOutcomes.AlreadyDecided; readonly decision: DeferredToolDecisionKinds; readonly argumentsDigest?: string }
	| { readonly outcome: DeferredToolDecisionOutcomes.InvalidArguments }
	| { readonly outcome: DeferredToolDecisionOutcomes.Conflict };
