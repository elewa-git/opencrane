import type { RuntimeExternalActionCandidate } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import type { ExternalActionExecutorDependencies } from "./external-action-executor.types.js";

/** Typed failure emitted when an admitted snapshot did not authorize a personal memory dataset. */
export class MemoryScopeUnavailableError extends Error
{
	/** Creates a failure that cannot fall back to subject-selected memory. */
	constructor()
	{
		super("personal memory scope is unavailable for this run snapshot");
		this.name = "MemoryScopeUnavailableError";
	}
}

/** Read a string field from a candidate's canonical argument object, or null when absent. */
function _stringArgument(candidate: RuntimeExternalActionCandidate, key: string): string | null
{
	const args = candidate.arguments;
	if (!args || typeof args !== "object" || Array.isArray(args)) return null;
	const value = (args as { readonly [field: string]: JsonValue })[key];
	return typeof value === "string" ? value : null;
}

/**
 * Query only the personal dataset frozen into the admitted run snapshot.
 *
 * The subject id is correlation metadata rather than a selector: callers cannot replace the
 * snapshot's dataset through tool arguments or pick a dataset from the subject at execution time.
 *
 * @param candidate - Admitted memory-action candidate containing an optional text query.
 * @param dependencies - Frozen dataset, subject correlation identity, and memory gateway port.
 * @returns Bounded fact identifiers and content for the runtime's tool result.
 * @throws {MemoryScopeUnavailableError} When admission did not authorize a personal dataset.
 */
export async function _ExecuteMemoryExternalAction(candidate: RuntimeExternalActionCandidate, dependencies: ExternalActionExecutorDependencies): Promise<JsonValue>
{
	if (dependencies.cogneeDatasetId === null) throw new MemoryScopeUnavailableError();
	const query = _stringArgument(candidate, "query") ?? "";
	const result = await dependencies.memoryGateway.query({ siloId: dependencies.siloId, cogneeDatasetId: dependencies.cogneeDatasetId, subjectId: dependencies.subjectId, query, maxResults: 20 });
	return result.facts.map(function _fact(fact) { return { factId: fact.factId, content: fact.content }; });
}
