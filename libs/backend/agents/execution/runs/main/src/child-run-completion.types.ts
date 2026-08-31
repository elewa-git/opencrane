/** Request to append one terminal child result to its direct parent's event stream. */
export interface ChildRunCompletionCommand
{
	/** Terminal child run whose outcome is being delivered. */
	readonly childRunId: string;
}

/**
 * Persists a terminal child result inside the authority transaction opened by its caller.
 *
 * The implementation must save the delivery ledger and any parent event in that transaction. A
 * `parent_stream_terminal` suppression belongs to the current parent attempt, so a later parent
 * attempt may submit the same child again.
 *
 * Called by: `PrismaRuntimeTerminalChildDeliveryUnitOfWork`,
 * `PrismaAgentRunWarmRuntimeRepository`, and `PrismaAgentRunAuthorityRepository`.
 */
export interface ChildRunCompletionRepository
{
	/**
	 * Resolves the child's terminal result against the current child and parent attempts.
	 *
	 * @param command - Identifies the child whose result must reach its direct parent.
	 * @returns Whether this call appended, suppressed, replayed, ignored, or denied the delivery.
	 * @throws When persistence fails or a database authority constraint rejects the writes. The
	 * caller must roll back the transaction rather than commit either half of the delivery.
	 */
	deliver(command: ChildRunCompletionCommand): Promise<ChildRunCompletionResult>;
}

/**
 * What happened when a finished child run's result was handed to its parent.
 *
 * `delivered` means this call appended the parent event. `suppressed` records why the current parent
 * attempt could not receive it; callers must not retry that attempt, but a later parent attempt may
 * reconsider `parent_stream_terminal`. `idempotent` replays a saved delivery or suppression without
 * appending another event. `ignored` means the child does not exist or is not terminal yet, so the
 * caller may try again after its state changes. `denied` means the command does not identify a direct
 * child or its saved lineage conflicts with the parent.
 */
export type ChildRunCompletionResult =
	| { readonly outcome: "delivered"; readonly parentRunId: string; readonly parentEventSequence: number }
	| { readonly outcome: "suppressed"; readonly parentRunId: string; readonly reason: "no_parent_stream" | "parent_stream_terminal" }
	| { readonly outcome: "idempotent"; readonly parentRunId: string; readonly parentEventSequence: number | null; readonly delivery: "delivered" | "no_parent_stream" | "parent_stream_terminal" }
	| { readonly outcome: "ignored"; readonly reason: "child_not_found" | "child_not_terminal" }
	| { readonly outcome: "denied"; readonly reason: "not_child_run" | "lineage_conflict" };
