import { createHash } from "node:crypto";

import { ___CanonicalizeJson, type JsonValue } from "@opencrane/util";

import { _IsPersonalConfigurationPatch } from "./personal-configuration-patch.js";
import { PersonalConfigurationProposalCodes, type PersonalConfigurationChangeRepository, type ProposePersonalConfigurationChangeCommand, type ProposePersonalConfigurationChangeResult } from "./personal-configuration-proposal.types.js";

/** Persist a future-snapshot-only personal configuration proposal after strict coordinate validation. */
export async function __ProposePersonalConfigurationChange(repository: PersonalConfigurationChangeRepository, command: ProposePersonalConfigurationChangeCommand): Promise<ProposePersonalConfigurationChangeResult>
{
	// 1. Refuse caller-controlled empty identities or malformed evidence before persistence can be queried.
	if (!_valid(command.siloId) || !_valid(command.userId) || !_valid(command.personaProfileId) || !_valid(command.agentServiceId) || !_valid(command.sourceThreadId) || !_valid(command.sourceRunId) || (command.sourceMessageId !== null && !_valid(command.sourceMessageId)) || !_IsPersonalConfigurationPatch(command.requestedPatch) || _DigestPatch(command.requestedPatch) !== command.requestedPatchDigest || Number.isNaN(Date.parse(command.proposedAt)))
	{
		return { outcome: PersonalConfigurationProposalCodes.Denied, reason: PersonalConfigurationProposalCodes.InvalidCommand };
	}

	// 2. Insert through one authority transaction so source ownership cannot race a proposal.
	const result = await repository.proposeAtomically(command);
	if (result.status === PersonalConfigurationProposalCodes.Proposed) return { outcome: PersonalConfigurationProposalCodes.Proposed, changeId: result.changeId };
	return { outcome: PersonalConfigurationProposalCodes.Denied, reason: result.status };
}

/** Require a bounded non-empty identifier without defining an identifier syntax owned elsewhere. */
function _valid(value: string): boolean
{
	return value.trim().length > 0 && value.length <= 200;
}

/** Canonicalise JSON-compatible input before deriving the only durable patch identity. */
function _DigestPatch(value: Readonly<Record<string, unknown>>): string | null
{
	try
	{
		return `sha256:${createHash("sha256").update(___CanonicalizeJson(value as JsonValue), "utf8").digest("hex")}`;
	}
	catch
	{
		return null;
	}
}
