import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _IsPersonalConfigurationPatch } from "./personal-configuration-patch.js";
import { PersonalConfigurationProposalCodes, type PersonalConfigurationChangeRepository, type ProposePersonalConfigurationChangeCommand, type ProposePersonalConfigurationChangeResult } from "./personal-configuration-proposal.types.js";

/**
 * Validates a requested configuration change and records it for the user to decide later.
 *
 * Nothing about the agent changes here, and the run that asked for the change is unaffected —
 * it keeps the input snapshot it was admitted with. Validation happens before any query, so a
 * malformed command never reaches the database, and the digest is recomputed from the patch so
 * a caller cannot record a digest that does not match what it asked for.
 *
 * Called by: {@link PrismaUpgradeSessionProposalRepository.proposeUpgradeSession}, when an agent
 * calls the `upgrade_session` tool.
 *
 * @param repository - Re-checks ownership and inserts, in one transaction.
 * @param command - The request to record.
 * @returns `Proposed` with the new `changeId`; `Denied` with `InvalidCommand` when the command
 * is malformed, `ProvenanceConflict` when the sources are not this user's or a revision moved
 * on, or `PersistenceUnavailable` when the write failed. Only the last is worth retrying.
 */
export async function __ProposePersonalConfigurationChange(repository: PersonalConfigurationChangeRepository, command: ProposePersonalConfigurationChangeCommand): Promise<ProposePersonalConfigurationChangeResult>
{
	// 1. Refuse blank ids, an unsupported patch, a mismatched digest, or a bad timestamp before touching the database.
	if (!_valid(command.siloId) || !_valid(command.userId) || !_valid(command.personaProfileId) || !_valid(command.agentServiceId) || !_valid(command.sourceConversationId) || !_valid(command.sourceRunId) || (command.sourceMessageId !== null && !_valid(command.sourceMessageId)) || !_IsPersonalConfigurationPatch(command.requestedPatch) || _DigestPatch(command.requestedPatch) !== command.requestedPatchDigest || Number.isNaN(Date.parse(command.proposedAt)))
	{
		return { outcome: PersonalConfigurationProposalCodes.Denied, reason: PersonalConfigurationProposalCodes.InvalidCommand };
	}

	// 2. Insert in one transaction, so the conversation, run, and service cannot change owner while the proposal is written.
	const result = await repository.proposeAtomically(command);
	if (result.status === PersonalConfigurationProposalCodes.Proposed) return { outcome: PersonalConfigurationProposalCodes.Proposed, changeId: result.changeId };
	return { outcome: PersonalConfigurationProposalCodes.Denied, reason: result.status };
}

/** Returns whether a value is non-blank and at most 200 characters; the id format itself is checked elsewhere. */
function _valid(value: string): boolean
{
	return value.trim().length > 0 && value.length <= 200;
}

/**
 * Digests the patch in canonical JSON form, so the same patch always produces the same digest.
 *
 * Canonical form is what makes the digest usable as the patch's identity: two JSON objects with
 * the same fields in a different order must not produce two different digests.
 *
 * @param value - The patch to digest.
 * @returns A `sha256:<hex>` digest, or null when the value cannot be canonicalised, which the
 * caller refuses as `InvalidCommand` rather than storing an unverifiable digest.
 * @see https://www.rfc-editor.org/rfc/rfc8785 — RFC 8785 (JSON Canonicalization Scheme): the
 * key-ordering and string-escaping rules `___DigestCanonicalJson` implements.
 */
function _DigestPatch(value: Readonly<Record<string, unknown>>): string | null
{
	try
	{
		return ___DigestCanonicalJson(value as JsonValue);
	}
	catch
	{
		return null;
	}
}
