import type { JsonValue } from "@opencrane/util";

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

/** Result of creating or idempotently replaying one pending deferred-tool approval. */
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
	/** Digest carried beside the frozen compiled parameters schema. */
	readonly parametersSchemaDigest: string;
	/** Digest of the effective capability set admitted for this attempt. */
	readonly capabilitySetDigest: string;
	/** Durable ToolInvocation row already reserved before approval creation. */
	readonly reservationId: string;
	/** Trusted server instant used for approval creation and failure terminalisation. */
	readonly now: Date;
	/** Hard server-owned expiry for the pending approval. */
	readonly expiresAt: Date;
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
