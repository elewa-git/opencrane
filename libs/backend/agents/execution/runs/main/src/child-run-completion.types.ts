/** Request to append one terminal child result to its direct parent's event stream. */
export interface ChildRunCompletionCommand
{
	/** Terminal child run whose outcome is being delivered. */
	readonly childRunId: string;
}

/**
 * What happened when a finished child run's result was handed to its parent.
 *
 * Five outcomes, and only one of them means the parent saw anything. `delivered` appended an event
 * to the parent. `suppressed` means the parent had nowhere to receive it — no conversation stream,
 * or a stream that has already ended — and that is a normal, final state, not an error to retry.
 * `idempotent` means an earlier identical delivery already settled this; its `delivery` field says
 * which of the first three outcomes that was. `ignored` means the child is not there or has not
 * finished, so the caller is early and may try again later. `denied` is the only one that means
 * something is wrong: a lineage mismatch needs an operator, while `persistence_unavailable` says
 * nothing is known about whether the write happened and must be retried with the same command.
 */
export type ChildRunCompletionResult =
	| { readonly outcome: "delivered"; readonly parentRunId: string; readonly parentEventSequence: number }
	| { readonly outcome: "suppressed"; readonly parentRunId: string; readonly reason: "no_parent_stream" | "parent_stream_terminal" }
	| { readonly outcome: "idempotent"; readonly parentRunId: string; readonly parentEventSequence: number | null; readonly delivery: "delivered" | "no_parent_stream" | "parent_stream_terminal" }
	| { readonly outcome: "ignored"; readonly reason: "child_not_found" | "child_not_terminal" }
	| { readonly outcome: "denied"; readonly reason: "not_child_run" | "lineage_conflict" | "persistence_unavailable" };

/** Persistence boundary that owns the idempotent child-to-parent completion hand-off. */
export interface ChildRunCompletionRepository
{
	/**
	 * Delivers the finished child's result to its parent, at most once.
	 *
	 * Named `Atomically` because the parent event and the record that it was delivered commit in one
	 * transaction; a repeat call can therefore never append a second event.
	 *
	 * @param command - The finished child run to deliver.
	 * @returns One of the {@link ChildRunCompletionResult} outcomes; only `denied` with
	 * `persistence_unavailable` should be retried.
	 */
	deliverAtomically(command: ChildRunCompletionCommand): Promise<ChildRunCompletionResult>;
}
