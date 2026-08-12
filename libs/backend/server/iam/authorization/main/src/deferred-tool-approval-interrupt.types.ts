import type { AgUiProjectionSourceEvent } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

/** Redacted copies stored alongside the approval, so reads never have to touch the server-only arguments. */
export interface DeferredToolApprovalProjection
{
	/** Proposed arguments with schema-marked secret values omitted. */
	readonly proposedArguments: JsonValue;
	/** Decision response schema derived from the frozen reviewed parameters schema. */
	readonly responseSchema: JsonValue;
}

/** Owner coordinates supplied by an already-authorized conversation stream. */
export interface ApprovalInterruptReadCommand
{
	/** Immutable conversation whose unresolved approval overlay is being read. */
	readonly conversationId: string;
	/** Silo derived from the authenticated conversation reader. */
	readonly siloId: string;
	/** Subject derived from the authenticated conversation reader. */
	readonly subjectId: string;
}

/** Reader the conversations package calls; it is declared here so that package need not depend on this one. */
export interface DeferredToolApprovalInterruptReader
{
	/** Read current owner-bound approval overlays without advancing a conversation cursor. */
	readOpen(command: ApprovalInterruptReadCommand): Promise<readonly AgUiProjectionSourceEvent[]>;
}

/** Stable actor-facing states returned for one owned deferred-tool interrupt. */
export enum DeferredToolApprovalStates
{
	/** The interrupt remains actionable before its server-owned expiry. */
	Pending = "pending",
	/** The interrupt approved one exact normalized argument object. */
	Approved = "approved",
	/** The interrupt was refused by its owner. */
	Denied = "denied",
	/** The interrupt reached its server-owned deadline before a decision. */
	Expired = "expired",
	/** The owning run closed the interrupt before a decision. */
	Cancelled = "cancelled",
}

/** Product-safe metadata for one actor-owned deferred tool interrupt. */
export interface SelfDeferredToolApproval
{
	/** Interrupt identifier used to submit a later decision. */
	readonly approvalRequestId: string;
	/** Logical personal run paused behind this decision. */
	readonly runId: string;
	/** Current attempt waiting for the decision. */
	readonly attempt: number;
	/** Immutable tool revision that the owner is being asked to allow. */
	readonly toolRevisionId: string;
	/** Runtime tool-call identifier used to bind the interrupt projection. */
	readonly toolInvocationId: string;
	/** Actor-relevant durable or deadline-derived state. */
	readonly state: DeferredToolApprovalStates;
	/** Proposed arguments with every schema-marked secret value omitted. */
	readonly proposedArguments: JsonValue;
	/** Exact decision-body schema derived from the frozen reviewed tool parameters schema. */
	readonly responseSchema: JsonValue;
	/** Server deadline after which the approval stops being actionable. */
	readonly expiresAt: string;
	/** Server time when the approval was opened. */
	readonly createdAt: string;
}

/** Read-only persistence boundary for the signed-in owner's approval inbox and detail. */
export interface SelfDeferredToolApprovalListRepository
{
	/** Proves the caller still owns an active membership in the exact silo snapshot. */
	hasActiveMembership(siloId: string, subjectId: string): Promise<boolean>;
	/** Lists at most fifty actionable tool approvals owned by one exact caller in one silo. */
	listPendingOwned(siloId: string, subjectId: string, now: Date): Promise<readonly SelfDeferredToolApproval[]>;
	/** Lists actionable interrupts for one exact owner-visible conversation. */
	listPendingOwnedForConversation(conversationId: string, siloId: string, subjectId: string, now: Date): Promise<readonly SelfDeferredToolApproval[]>;
	/** Reads one actor-owned tool interrupt without selecting server-only arguments or resume material. */
	readOwned(approvalRequestId: string, siloId: string, subjectId: string, now: Date): Promise<SelfDeferredToolApproval | null>;
}

/** Atomic read boundary that snapshots membership and actor-safe approval data together. */
export interface SelfDeferredToolApprovalReadUnitOfWork
{
	/** Lists actionable approvals only while the caller's membership remains active. */
	listPendingOwned(siloId: string, subjectId: string, now: Date): Promise<readonly SelfDeferredToolApproval[]>;
	/** Lists conversation overlays only while the caller's membership remains active. */
	listPendingOwnedForConversation(conversationId: string, siloId: string, subjectId: string, now: Date): Promise<readonly SelfDeferredToolApproval[]>;
	/** Reads one detail only while the caller's membership remains active. */
	readOwned(approvalRequestId: string, siloId: string, subjectId: string, now: Date): Promise<SelfDeferredToolApproval | null>;
}
