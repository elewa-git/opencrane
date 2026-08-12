import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";
import { z } from "zod";

import { _PersonalConfigurationPatchSchema } from "./personal-configuration-patch.validator.js";
import type { PersonalConfigurationPatch } from "./personal-configuration-patch.types.js";
import type { ProposePersonalConfigurationChangeCommand } from "./personal-configuration-proposal.types.js";

/** Bounded nonblank coordinate accepted without transforming the value before persistence. */
const _IdentifierSchema = z.string().max(200).refine(function _NonBlank(value) { return value.trim().length > 0; }, "must not be blank");

/** Strict proposal command schema with canonical patch identity verification. */
const _PersonalConfigurationProposalCommandSchema: z.ZodType<ProposePersonalConfigurationChangeCommand> = z.object({
	siloId: _IdentifierSchema,
	userId: _IdentifierSchema,
	personaProfileId: _IdentifierSchema,
	agentServiceId: _IdentifierSchema,
	sourceConversationId: _IdentifierSchema,
	sourceRunId: _IdentifierSchema,
	sourceMessageId: _IdentifierSchema.nullable(),
	requestedPatch: _PersonalConfigurationPatchSchema,
	requestedPatchDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
	expectedPersonaRevisionId: _IdentifierSchema.nullable(),
	expectedAgentRevisionId: _IdentifierSchema.nullable(),
	proposedAt: z.string().datetime({ offset: true }),
}).strict().superRefine(function _MatchingPatchDigest(command, context)
{
	if (_DigestPatch(command.requestedPatch) === command.requestedPatchDigest) return;
	context.addIssue({ code: z.ZodIssueCode.custom, path: ["requestedPatchDigest"], message: "must match the canonical patch digest" });
});

/** Parse an exact proposal command, returning null without leaking validation details. */
export function _ParsePersonalConfigurationProposalCommand(value: unknown): ProposePersonalConfigurationChangeCommand | null
{
	const parsed = _PersonalConfigurationProposalCommandSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/** Canonicalise JSON-compatible input before deriving the only durable patch identity. */
function _DigestPatch(value: PersonalConfigurationPatch): string | null
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
