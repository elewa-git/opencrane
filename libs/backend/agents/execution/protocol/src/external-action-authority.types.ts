import type { CompiledToolDefinition, RunInputSnapshot, RuntimeExternalActionCandidate } from "@opencrane/contracts";
import type { ToolInvocationReceipt } from "@opencrane/backend/server/iam/authorization";

/** Deferred external tool executor invoked only after a durable invocation reservation exists. */
export interface ExternalActionExecutor<TResult>
{
	/** Executes the external tool outside the reservation transaction. */
	execute(): Promise<TResult>;
}

/** One validated external-action candidate submitted for reserve-before-dispatch handling. */
export interface ExecuteExternalActionCommand
{
	/** Runtime-proposed external action, never a direct tool call. */
	readonly candidate: RuntimeExternalActionCandidate;
	/** Immutable input snapshot that fixed the attempt's tool grants. */
	readonly snapshot: RunInputSnapshot;
	/**
	 * Compiled tool definitions resolved from the snapshot's tool grants. Their `toolRevisionId`
	 * values are the only revisions the attempt may invoke, so the candidate's revision must be one
	 * of them or the action is denied before any reservation.
	 */
	readonly compiledTools: readonly CompiledToolDefinition[];
	/** Whether this invocation must pause for a deferred approval rather than dispatch immediately. */
	readonly approvalRequired: boolean;
}

/** Stable reason an external action failed closed before or after reservation. */
export type ExternalActionFailureReason =
	| "run_attempt_mismatch"
	| "tool_revision_not_granted"
	| "arguments_digest_mismatch"
	| "invocation_reservation_failed"
	| "invocation_replay"
	| "invocation_execution_failed"
	| "invocation_execution_ambiguous";

/** Result of validating and dispatching one proposed external tool invocation. */
export type ExecuteExternalActionResult<TResult> =
	| { readonly outcome: "executed" | "replayed"; readonly receipt: ToolInvocationReceipt<TResult> }
	| { readonly outcome: "deferred"; readonly reservationId: string }
	| { readonly outcome: "denied"; readonly reason: ExternalActionFailureReason };
