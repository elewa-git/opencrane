import type { PersonalMemoryAdmissionRepository, ResolvePersonalMemoryDatasetCommand } from "./personal-memory-dataset.types.js";

/**
 * Returns the ids of the preference facts a user stated about themselves, for one run admission.
 *
 * Only Active facts with Explicit or Confirmed consent whose provenance names this same user
 * are included, so nothing message-derived and nothing belonging to another user can reach the
 * run. Incomplete identity returns an empty list rather than querying.
 *
 * Called by: `PrismaPersonalPreferenceFactSource` in
 * libs/backend/agents/execution/inputs/main/src/personal-memory-preference-fact-source.ts.
 *
 * @param repository - Reads inside the caller's admission transaction.
 * @param command - The three verified identity fields.
 * @returns Fact ids only, never fact content. Empty means "nothing to include", which is a
 * normal result and not a failure — the caller must not treat it as a denial.
 */
export async function __SelectPersonalPreferenceFactIds(repository: PersonalMemoryAdmissionRepository, command: ResolvePersonalMemoryDatasetCommand): Promise<readonly string[]>
{
	// 1. Reject incomplete ids first, so the database read cannot match a wider set of facts.
	if (!_IsValidPersonalMemoryPreferenceCommand(command)) return [];

	// 2. Let the repository do the query, inside the admission transaction the caller already opened.
	return repository.findActivePreferenceFactIds(command);
}

/** Returns whether the silo, organization, and subject ids are all present. */
function _IsValidPersonalMemoryPreferenceCommand(command: ResolvePersonalMemoryDatasetCommand): boolean
{
	return command.siloId.trim().length > 0 && command.organizationId.trim().length > 0 && command.subjectId.trim().length > 0;
}
