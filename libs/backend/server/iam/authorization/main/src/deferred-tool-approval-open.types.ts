import type { JsonValue } from "@opencrane/util";

/** Exact prepared tool invocation to pause behind a new pending deferred-tool approval. */
export interface DeferToolRequestCommand
{
	/** Interrupt id supplied by the reviewed runtime proposal and reused as the approval id. */
	readonly interruptId: string;
	/** Logical run proposing the external action. */
	readonly runId: string;
	/** Current positive run attempt. */
	readonly attempt: number;
	/** Awaiting-approval ToolInvocation row id the approval gates. */
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

/**
 * What opening an approval did.
 *
 * `deferred` created it; `already_deferred` found the identical approval from an earlier attempt —
 * both mean the tool call is now correctly parked. `unavailable` means it could not be opened at
 * all (the run's pod is gone, its proof key expired, the deadline is already past, or the run is
 * not in a state that can pause), and the caller must fail the tool call rather than wait.
 */
export type DeferToolRequestResult =
	| { readonly outcome: "deferred"; readonly approvalRequestId: string }
	| { readonly outcome: "already_deferred"; readonly approvalRequestId: string }
	| { readonly outcome: "unavailable" };

/**
 * Everything needed to open an approval for one already-prepared tool call.
 *
 * The digests are re-computed and compared before anything is written, so a caller that passes an
 * arguments or schema digest that does not match its value gets the tool call failed with
 * `approval_arguments_invalid` rather than an approval a reviewer could not trust.
 */
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
	/** Durable ToolInvocation row already awaiting approval creation. */
	readonly invocationId: string;
	/** Server time used both when creating the approval and when terminalising a failure. */
	readonly now: Date;
	/** Hard server-owned expiry for the pending approval. */
	readonly expiresAt: Date;
}

/**
 * The three writes and reads needed to open one approval, or to clean up after an unclear commit.
 *
 * All three run on the caller's transaction. `hasLinkedApproval` exists purely for recovery: if the
 * open transaction throws after the database may already have committed, a linked approval proves
 * the create succeeded and the tool call must NOT be failed.
 *
 * Implemented by: ./prisma-deferred-tool-approval-opener.ts.
 * @see {@link DeferredToolApprovalOpenUnitOfWork}
 */
export interface DeferredToolApprovalOpenRepository
{
	/** Creates the approval, checking the run's live workload assignment and proof key on this transaction. */
	defer(command: DeferToolRequestCommand): Promise<DeferToolRequestResult>;
	/**
	 * Fails one tool call that is still waiting for approval, and records its result delivery.
	 * @returns False when the tool call is no longer awaiting approval, meaning something else
	 *   already moved it and the caller must not assume it was failed.
	 */
	terminaliseAwaitingApproval(invocationId: string, failureCode: string, now: Date): Promise<boolean>;
	/** Return whether the exact interrupt is durably linked to its invocation. */
	hasLinkedApproval(command: OpenDeferredToolApprovalCommand): Promise<boolean>;
}

/**
 * Opens one approval and guarantees the tool call never ends up stuck waiting.
 *
 * Either an approval exists afterwards, or the tool call has been failed. It never leaves a tool
 * call in `AwaitingApproval` with no approval to decide.
 *
 * Implemented by: ./prisma-deferred-tool-approval-opener.ts (`__OpenDeferredToolApproval`).
 */
export interface DeferredToolApprovalOpenUnitOfWork
{
	/** Opens an approval or proves the invocation terminal without exposing Prisma. */
	open(command: OpenDeferredToolApprovalCommand): Promise<boolean>;
}
