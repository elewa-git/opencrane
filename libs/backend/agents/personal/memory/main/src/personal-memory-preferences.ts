import type { PersonalMemoryAdmissionRepository, ResolvePersonalMemoryDatasetCommand } from "./personal-memory-dataset.types.js";

/** Selects only active, consented, owner-proven preference fact identifiers for one personal admission. */
export async function __SelectPersonalPreferenceFactIds(repository: PersonalMemoryAdmissionRepository, command: ResolvePersonalMemoryDatasetCommand): Promise<readonly string[]>
{
	// 1. Reject incomplete coordinates before a persistence read could accidentally broaden the personal scope.
	if (!_IsValidPersonalMemoryPreferenceCommand(command)) return [];

	// 2. Delegate all storage selection to the personal-memory repository inside the caller's existing admission transaction.
	return repository.findActivePreferenceFactIds(command);
}

/** Returns whether preference selection names every verified personal identity coordinate. */
function _IsValidPersonalMemoryPreferenceCommand(command: ResolvePersonalMemoryDatasetCommand): boolean
{
	return command.siloId.trim().length > 0 && command.organizationId.trim().length > 0 && command.subjectId.trim().length > 0;
}
