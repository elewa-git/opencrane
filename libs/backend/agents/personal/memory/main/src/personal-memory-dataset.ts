import type { PersonalMemoryDatasetRepository, ResolvePersonalMemoryDatasetCommand, ResolvePersonalMemoryDatasetResult } from "./personal-memory-dataset.types.js";

/** Resolves personal memory from signed identity coordinates and never from a caller-provided dataset identifier. */
export async function __ResolvePersonalMemoryDataset(repository: PersonalMemoryDatasetRepository, command: ResolvePersonalMemoryDatasetCommand): Promise<ResolvePersonalMemoryDatasetResult>
{
	// 1. Reject incomplete identity before a lookup could accidentally widen personal-memory scope.
	if (!_IsValidPersonalMemoryDatasetCommand(command)) return { outcome: "denied", reason: "memory_scope_unavailable" };

	// 2. Resolve only the exact active personal scope selected by the verified silo, organization, and subject.
	const dataset = await repository.findActivePersonalDataset(command);
	if (dataset === null) return { outcome: "denied", reason: "memory_scope_unavailable" };

	// 3. Refuse malformed persistence output so no invalid gateway dataset coordinate reaches later runtime composition.
	if (!dataset.datasetId.trim() || !dataset.cogneeDatasetId.trim()) return { outcome: "denied", reason: "memory_scope_unavailable" };
	return { outcome: "resolved", dataset };
}

/** Returns whether every proof-bound personal-memory coordinate is present. */
function _IsValidPersonalMemoryDatasetCommand(command: ResolvePersonalMemoryDatasetCommand): boolean
{
	return command.siloId.trim().length > 0 && command.organizationId.trim().length > 0 && command.subjectId.trim().length > 0;
}
