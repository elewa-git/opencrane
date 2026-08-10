import type { JsonValue } from "@opencrane/util";
import type { AgUiProjectionSourceEvent } from "@opencrane/contracts";

/** Safe projections persisted with an approval so reads never select server-only argument bytes. */
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
	readonly conversationId: string;
	readonly siloId: string;
	readonly subjectId: string;
}

/** Structural interrupt reader consumed by the conversations package without a reverse dependency. */
export interface DeferredToolApprovalInterruptReader
{
	/** Read current owner-bound approval overlays without advancing a conversation cursor. */
	readOpen(command: ApprovalInterruptReadCommand): Promise<readonly AgUiProjectionSourceEvent[]>;
}

/** Terminal decision a reviewer may record for a deferred tool request. */
export enum DeferredToolDecisionKinds
{
	/** Approves the exact complete argument object carried by the decision request. */
	Approved = "approved",
	/** Refuses the proposed tool invocation without creating resume authority. */
	Denied = "denied",
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

/** Exact reserved tool invocation to pause behind a new pending deferred-tool approval. */
export interface DeferToolRequestCommand
{
	/** Interrupt id supplied by the reviewed runtime proposal and reused as the approval id. */
	readonly interruptId: string;
	/** Logical run proposing the external action. */
	readonly runId: string;
	/** Current positive run attempt. */
	readonly attempt: number;
	/** Reserved ToolInvocation row id the approval gates. */
	readonly toolInvocationRowId: string;
	/** Immutable tool revision being invoked, recorded as the approval's resource id. */
	readonly toolRevisionId: string;
	/** Exact normalized arguments proposed by the reviewed runtime candidate. */
	readonly reviewedArguments: JsonValue;
	/** Digest of the normalized proposed arguments. */
	readonly argumentsDigest: string;
	/** Exact parameters schema from the reviewed compiled tool definition. */
	readonly reviewedParametersSchema: JsonValue;
	/** Digest of the frozen reviewed parameters schema. */
	readonly reviewedParametersSchemaDigest: string;
	/** Redacted proposed-argument projection safe for the owning actor. */
	readonly safeProposedArguments: JsonValue;
	/** Decision response schema derived from the reviewed parameters schema. */
	readonly responseSchema: JsonValue;
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
	/** Interrupt id emitted for the reviewed proposal and reused as the approval id. */
	readonly interruptId: string;
	/** Logical run proposing the external action. */
	readonly runId: string;
	/** Current positive run attempt. */
	readonly attempt: number;
	/** Runtime invocation identifier bound to the interrupt. */
	readonly toolInvocationId: string;
	/** Immutable tool revision being invoked. */
	readonly toolRevisionId: string;
	/** Exact normalized arguments from the reviewed runtime candidate. */
	readonly arguments: JsonValue;
	/** Digest of the normalized action arguments. */
	readonly argumentsDigest: string;
	/** Exact parameters schema from the reviewed compiled tool definition. */
	readonly parametersSchema: JsonValue;
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
	| { readonly outcome: "approved"; readonly argumentsDigest: string }
	| { readonly outcome: "denied" }
	| { readonly outcome: "expired" }
	| { readonly outcome: "already_decided"; readonly decision: DeferredToolDecisionKinds; readonly argumentsDigest?: string }
	| { readonly outcome: "invalid_arguments" }
	| { readonly outcome: "conflict" };

/** Atomic persistence boundary for a session-authorized deferred-tool decision. */
export interface DeferredToolApprovalDecisionRepository
{
	/** Decide one request only when its durable run coordinates still match the authenticated owner. */
	decideAtomically(command: DecideDeferredToolRequestCommand): Promise<DecideDeferredToolRequestResult>;
}

/** Transaction-scoped persistence operations used while opening or recovering one approval. */
export interface DeferredToolApprovalOpenRepository
{
	/** Open the approval against the exact transaction-owned workload fence. */
	defer(command: DeferToolRequestCommand): Promise<DeferToolRequestResult>;
	/** Compare-and-set one reserved invocation to a stable failure. */
	markReservedFailed(reservationId: string, failureCode: string, now: Date): Promise<boolean>;
	/** Return whether the exact interrupt is durably linked to its reservation. */
	hasLinkedApproval(command: OpenDeferredToolApprovalCommand): Promise<boolean>;
}

/** Atomic boundary for opening and ambiguity-recovering one deferred tool approval. */
export interface DeferredToolApprovalOpenUnitOfWork
{
	/** Opens an approval or proves the reservation terminal without exposing Prisma. */
	open(command: OpenDeferredToolApprovalCommand): Promise<boolean>;
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
	/** Lists at most fifty actionable tool approvals owned by one exact caller in one silo. */
	listPendingOwned(siloId: string, subjectId: string, now: Date): Promise<readonly SelfDeferredToolApproval[]>;
	/** Lists actionable interrupts for one exact owner-visible conversation. */
	listPendingOwnedForConversation(conversationId: string, siloId: string, subjectId: string, now: Date): Promise<readonly SelfDeferredToolApproval[]>;
	/** Reads one actor-owned tool interrupt without selecting server-only arguments or resume material. */
	readOwned(approvalRequestId: string, siloId: string, subjectId: string, now: Date): Promise<SelfDeferredToolApproval | null>;
}
