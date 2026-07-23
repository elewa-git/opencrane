import { createHash } from "node:crypto";

import { ___CanonicalizeJson, type JsonValue } from "@opencrane/util";

import type { PersonalConfigurationChangeRepository, ProposePersonalConfigurationChangeCommand, ProposePersonalConfigurationChangeResult } from "./personal-configuration.types.js";

/** Persist a future-snapshot-only personal configuration proposal after strict coordinate validation. */
export async function __ProposePersonalConfigurationChange(repository: PersonalConfigurationChangeRepository, command: ProposePersonalConfigurationChangeCommand): Promise<ProposePersonalConfigurationChangeResult>
{
	// 1. Refuse caller-controlled empty identities or malformed evidence before persistence can be queried.
	if (!_valid(command.siloId) || !_valid(command.userId) || !_valid(command.personaProfileId) || !_valid(command.agentServiceId) || !_valid(command.sourceThreadId) || !_valid(command.sourceRunId) || (command.sourceMessageId !== null && !_valid(command.sourceMessageId)) || !_patchIsObject(command.requestedPatch) || _DigestPatch(command.requestedPatch) !== command.requestedPatchDigest || Number.isNaN(Date.parse(command.proposedAt)))
	{
		return { outcome: "denied", reason: "invalid_command" };
	}

	// 2. Insert through one authority transaction so source ownership cannot race a proposal.
	const result = await repository.proposeAtomically(command);
	if (result.status === "proposed") return { outcome: "proposed", changeId: result.changeId };
	return { outcome: "denied", reason: result.status };
}

/** Require a bounded non-empty identifier without defining an identifier syntax owned elsewhere. */
function _valid(value: string): boolean
{
	return value.trim().length > 0 && value.length <= 200;
}

/** Preserve only object-shaped proposal payloads for later explicit policy evaluation. */
function _patchIsObject(value: unknown): value is Readonly<Record<string, unknown>>
{
	return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
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
