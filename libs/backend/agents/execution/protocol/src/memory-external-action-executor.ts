import type { JsonValue } from "@opencrane/util";

import type { DurableExternalActionCommand, ExternalActionExecutorDependencies } from "./external-action-executor.types.js";

/**
 * Thrown when the run's snapshot names no personal memory dataset.
 *
 * There is deliberately no fallback: a run admitted without a personal memory policy must not be
 * able to reach any dataset, so asking for memory is an error rather than an empty result. Nothing
 * has been sent, so the catcher completes the invocation as failed - `_provenPreDispatchFailure`
 * maps it to `memory_scope_unavailable` - and it must not be retried, because the snapshot cannot
 * change.
 *
 * Raised by `_ExecuteMemoryExternalAction`; caught by `_provenPreDispatchFailure`
 * (production-external-action-adapter.ts).
 *
 * @see __PersonalMemoryDatasetId which decides whether a dataset exists.
 */
export class MemoryScopeUnavailableError extends Error
{
	/** Creates the error. There is deliberately no fallback to a dataset chosen from the subject. */
	constructor()
	{
		super("personal memory scope is unavailable for this run snapshot");
		this.name = "MemoryScopeUnavailableError";
	}
}

/** Read a string field from a candidate's canonical argument object, or null when absent. */
function _stringArgument(candidate: DurableExternalActionCommand, key: string): string | null
{
	const args = candidate.arguments;
	if (!args || typeof args !== "object" || Array.isArray(args)) return null;
	const value = (args as { readonly [field: string]: JsonValue })[key];
	return typeof value === "string" ? value : null;
}

/**
 * Query only the personal dataset frozen into the admitted run snapshot.
 *
 * The subject id is passed along for correlation only; it never selects anything. Callers cannot
 * swap the snapshot's dataset through tool arguments, or pick one from the subject at run time.
 *
 * @param candidate - Admitted memory-action candidate containing an optional text query.
 * @param dependencies - Frozen dataset, subject correlation identity, and memory gateway port.
 * @returns Bounded fact identifiers and content for the runtime's tool result.
 * @throws {MemoryScopeUnavailableError} When admission did not authorize a personal dataset.
 */
export async function _ExecuteMemoryExternalAction(candidate: DurableExternalActionCommand, dependencies: ExternalActionExecutorDependencies): Promise<JsonValue>
{
	if (dependencies.cogneeDatasetId === null) throw new MemoryScopeUnavailableError();
	const query = _stringArgument(candidate, "query") ?? "";
	const result = await dependencies.memoryGateway.query({ siloId: dependencies.siloId, cogneeDatasetId: dependencies.cogneeDatasetId, subjectId: dependencies.subjectId, query, maxResults: 20 });
	return result.facts.map(function _fact(fact) { return { factId: fact.factId, content: fact.content }; });
}
