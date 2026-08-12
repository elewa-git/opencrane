import { PersonalMemoryDatasetResolutionDenialReasons, PersonalMemoryDatasetResolutionOutcomes } from "./personal-memory-dataset.types.js";
import type { PersonalMemoryAdmissionRepository, ResolvePersonalMemoryDatasetCommand, ResolvePersonalMemoryDatasetResult } from "./personal-memory-dataset.types.js";

/**
 * Finds a user's personal memory dataset from their verified identity.
 *
 * A caller can never name the dataset: it is selected from the silo, organization and subject
 * only. Incomplete identity is rejected before any query runs, so a partly-blank command
 * cannot widen the lookup, and a row with a blank id is refused rather than passed on, so no
 * invalid dataset id reaches the memory gateway later.
 *
 * Every failure returns the same vague reason, so no caller can probe for another user's scope.
 *
 * Called by: `PrismaPersonalMemoryScopeSource` in
 * libs/backend/agents/execution/inputs/main/src/personal-memory-scope-source.ts, during run
 * admission.
 *
 * @param repository - Reads inside the caller's admission transaction.
 * @param command - The three verified identity fields.
 * @returns `Resolved` with the dataset, or `Denied` with `MemoryScopeUnavailable`. A denial is
 * final for this run — the caller must fail the admission, not retry with different input.
 */
export async function __ResolvePersonalMemoryDataset(repository: PersonalMemoryAdmissionRepository, command: ResolvePersonalMemoryDatasetCommand): Promise<ResolvePersonalMemoryDatasetResult>
{
	// 1. Reject incomplete identity first, so a lookup cannot match a wider set of datasets.
	if (!_IsValidPersonalMemoryDatasetCommand(command)) return _MemoryScopeUnavailable();

	// 2. Look up only the active dataset for this verified silo, organization, and subject.
	const dataset = await repository.findActivePersonalDataset(command);
	if (dataset === null) return _MemoryScopeUnavailable();

	// 3. Refuse a row with blank ids, so no invalid dataset id reaches the memory gateway later.
	if (!dataset.datasetId.trim() || !dataset.cogneeDatasetId.trim()) return _MemoryScopeUnavailable();
	return { outcome: PersonalMemoryDatasetResolutionOutcomes.Resolved, dataset };
}

/** Builds the one vague denial used for every failure, so no failure reveals more than another. */
function _MemoryScopeUnavailable(): ResolvePersonalMemoryDatasetResult
{
	return { outcome: PersonalMemoryDatasetResolutionOutcomes.Denied, reason: PersonalMemoryDatasetResolutionDenialReasons.MemoryScopeUnavailable };
}

/** Returns whether the silo, organization, and subject ids are all present. */
function _IsValidPersonalMemoryDatasetCommand(command: ResolvePersonalMemoryDatasetCommand): boolean
{
	return command.siloId.trim().length > 0 && command.organizationId.trim().length > 0 && command.subjectId.trim().length > 0;
}
