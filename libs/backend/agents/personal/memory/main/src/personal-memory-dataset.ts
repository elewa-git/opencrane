import { PersonalMemoryDatasetResolutionDenialReasons, PersonalMemoryDatasetResolutionOutcomes } from "./personal-memory-dataset.types.js";
import type { PersonalMemoryAdmissionRepository, PersonalMemoryAdmissionUnitOfWork, ResolvePersonalMemoryDatasetCommand, ResolvePersonalMemoryDatasetResult } from "./personal-memory-dataset.types.js";

/** Resolves personal memory from signed identity coordinates and never from a caller-provided dataset identifier. */
export async function __ResolvePersonalMemoryDataset(repository: PersonalMemoryAdmissionRepository, unitOfWork: PersonalMemoryAdmissionUnitOfWork, command: ResolvePersonalMemoryDatasetCommand): Promise<ResolvePersonalMemoryDatasetResult>
{
	// 1. Reject incomplete identity before a lookup could accidentally widen personal-memory scope.
	if (!_IsValidPersonalMemoryDatasetCommand(command)) return _MemoryScopeUnavailable();

	// 2. Resolve only the exact active personal scope selected by the verified silo, organization, and subject.
	const dataset = await repository.findActivePersonalDataset(unitOfWork, command);
	if (dataset === null) return _MemoryScopeUnavailable();

	// 3. Refuse malformed persistence output so no invalid gateway dataset coordinate reaches later runtime composition.
	if (!dataset.datasetId.trim() || !dataset.cogneeDatasetId.trim()) return _MemoryScopeUnavailable();
	return { outcome: PersonalMemoryDatasetResolutionOutcomes.Resolved, dataset };
}

/** Builds the deliberately non-specific denial returned for every unavailable personal-memory scope. */
function _MemoryScopeUnavailable(): ResolvePersonalMemoryDatasetResult
{
	return { outcome: PersonalMemoryDatasetResolutionOutcomes.Denied, reason: PersonalMemoryDatasetResolutionDenialReasons.MemoryScopeUnavailable };
}

/** Returns whether every proof-bound personal-memory coordinate is present. */
function _IsValidPersonalMemoryDatasetCommand(command: ResolvePersonalMemoryDatasetCommand): boolean
{
	return command.siloId.trim().length > 0 && command.organizationId.trim().length > 0 && command.subjectId.trim().length > 0;
}
