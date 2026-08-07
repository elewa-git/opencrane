import type { JsonValue } from "@opencrane/util";

/** Terminal decision a reviewer may record for a deferred tool request. */
export type DeferredToolDecision = "approved" | "denied";

/** Exact pending deferred-tool request being decided, with the trusted decision instant. */
export interface DecideDeferredToolRequestCommand
{
	/** Approval row that gates the deferred tool invocation. */
	readonly approvalRequestId: string;
	/** Silo the authenticated reviewer is operating within. */
	readonly siloId: string;
	/** Authenticated subject that owns the approval-bound runtime action. */
	readonly subjectId: string;
	/** Reviewer's terminal decision. */
	readonly decision: DeferredToolDecision;
	/** Subject who recorded the decision. */
	readonly decidedBy: string;
	/** Trusted decision instant. */
	readonly now: Date;
	/** Hash of the single-use resume token, set only on approval so exactly one resume can proceed. */
	readonly resumeTokenHash?: string;
	/** Canonical authorized deferred tool result fed back on resume, set only on approval. */
	readonly deferredToolResult?: JsonValue;
}

/** Exact reserved tool invocation to pause behind a new pending deferred-tool approval. */
export interface DeferToolRequestCommand
{
	/** Logical run proposing the external action. */
	readonly runId: string;
	/** Current positive run attempt. */
	readonly attempt: number;
	/** Reserved ToolInvocation row id the approval gates. */
	readonly toolInvocationRowId: string;
	/** Immutable tool revision being invoked, recorded as the approval's resource id. */
	readonly toolRevisionId: string;
	/** Digest of the normalised action arguments. */
	readonly argumentsDigest: string;
	/** Deterministic per-invocation digest; the unique run/attempt key makes deferral idempotent. */
	readonly actionDigest: string;
	/** Digest of the effective policy the approval is evaluated against. */
	readonly effectivePolicyDigest: string;
	/** Stable identifier of the approver policy revision that required the pause. */
	readonly approverPolicyRevision: string;
	/** Trusted creation instant. */
	readonly now: Date;
	/** Hard expiry after which the pending approval is no longer actionable. */
	readonly expiresAt: Date;
}

/** Result of creating (or idempotently replaying) one pending deferred-tool approval. */
export type DeferToolRequestResult =
	| { readonly outcome: "deferred"; readonly approvalRequestId: string }
	| { readonly outcome: "already_deferred"; readonly approvalRequestId: string }
	| { readonly outcome: "unavailable" };

/** Exact reserved external-action coordinates needed to open a deferred approval. */
export interface OpenDeferredToolApprovalCommand
{
	/** Logical run proposing the external action. */
	readonly runId: string;
	/** Current positive run attempt. */
	readonly attempt: number;
	/** Runtime invocation identifier used as the approval action digest. */
	readonly toolInvocationId: string;
	/** Immutable tool revision being invoked. */
	readonly toolRevisionId: string;
	/** Digest of the normalised action arguments. */
	readonly argumentsDigest: string;
	/** Digest of the effective capability set admitted for this attempt. */
	readonly capabilitySetDigest: string;
	/** Durable ToolInvocation row already reserved before approval creation. */
	readonly reservationId: string;
	/** Trusted server instant used for approval creation and failure terminalisation. */
	readonly now: Date;
	/** Hard server-owned expiry for the pending approval. */
	readonly expiresAt: Date;
}

/** Result of atomically deciding one pending deferred tool request. */
export type DecideDeferredToolRequestResult =
	| { readonly outcome: "approved"; readonly deferredToolResult: JsonValue }
	| { readonly outcome: "denied" }
	| { readonly outcome: "expired" }
	| { readonly outcome: "already_decided"; readonly decision: DeferredToolDecision }
	| { readonly outcome: "conflict" };

/** Atomic persistence boundary for a session-authorized deferred-tool decision. */
export interface DeferredToolApprovalDecisionRepository
{
	/** Decide one request only when its durable run coordinates still match the authenticated owner. */
	decideAtomically(command: DecideDeferredToolRequestCommand): Promise<DecideDeferredToolRequestResult>;
}

/** Product-safe metadata for one still-actionable deferred tool approval. */
export interface SelfDeferredToolApproval
{
	/** Opaque approval identifier used to submit a later decision. */
	readonly approvalRequestId: string;
	/** Logical personal run paused behind this decision. */
	readonly runId: string;
	/** Current attempt waiting for the decision. */
	readonly attempt: number;
	/** Immutable tool revision that the owner is being asked to allow. */
	readonly toolRevisionId: string;
	/** Server deadline after which the approval stops being actionable. */
	readonly expiresAt: string;
	/** Server time when the approval was opened. */
	readonly createdAt: string;
}

/** Read-only persistence boundary for the signed-in owner's pending approvals inbox. */
export interface SelfDeferredToolApprovalListRepository
{
	/** Lists at most fifty actionable tool approvals owned by one exact caller in one silo. */
	listPendingOwned(siloId: string, subjectId: string, now: Date): Promise<readonly SelfDeferredToolApproval[]>;
}
