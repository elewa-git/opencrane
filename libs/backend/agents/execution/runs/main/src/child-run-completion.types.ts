/** Request to append one terminal child result to its direct parent's event stream. */
export interface ChildRunCompletionCommand
{
	/** Terminal child run whose outcome is being delivered. */
	readonly childRunId: string;
}

/** Stable result of recording or replaying a child completion delivery. */
export type ChildRunCompletionResult =
	| { readonly outcome: "delivered"; readonly parentRunId: string; readonly parentEventSequence: number }
	| { readonly outcome: "suppressed"; readonly parentRunId: string; readonly reason: "no_parent_stream" | "parent_stream_terminal" }
	| { readonly outcome: "idempotent"; readonly parentRunId: string; readonly parentEventSequence: number | null; readonly delivery: "delivered" | "no_parent_stream" | "parent_stream_terminal" }
	| { readonly outcome: "ignored"; readonly reason: "child_not_found" | "child_not_terminal" }
	| { readonly outcome: "denied"; readonly reason: "not_child_run" | "lineage_conflict" | "persistence_unavailable" };

/** Persistence boundary that owns the idempotent child-to-parent completion hand-off. */
export interface ChildRunCompletionRepository
{
	/** Appends one parent event or records why a parent stream cannot receive it. */
	deliverAtomically(command: ChildRunCompletionCommand): Promise<ChildRunCompletionResult>;
}
