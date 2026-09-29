import { CompiledToolDefinitionKinds, FIRST_PARTY_TOOL_CAPABILITY_CONTRACTS, FirstPartyToolCapabilities, FirstPartyToolEffectKinds, FirstPartyToolMaterializationKinds, type CompiledFirstPartyToolDefinition } from "@opencrane/contracts";
import { __RoutineScheduleSchema } from "@opencrane/models/agents";
import { ___DigestCanonicalJson } from "@opencrane/util";
import { z } from "zod";

import type { RequestRoutineSuggestion } from "./request-routine.types";

/** Validates the strict first-party arguments without accepting identity, audience or proposal coordinates. */
export const ___RequestRoutineSuggestionSchema: z.ZodType<RequestRoutineSuggestion> = z.object({
	instruction: z.string().trim().min(1).max(20_000),
	schedule: __RoutineScheduleSchema,
}).strict();

const _REQUEST_ROUTINE_PARAMETERS_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["instruction", "schedule"],
	properties: {
		instruction: { type: "string", minLength: 1, maxLength: 20_000 },
		schedule: {
			type: "object",
			additionalProperties: false,
			required: ["expression", "timezone"],
			properties: { expression: { type: "string", minLength: 1, maxLength: 256 }, timezone: { type: "string", minLength: 1, maxLength: 128 } },
		},
	},
} as const;

/** The exact first-party descriptor offered only after scheduling-owned capability admission. */
export const REQUEST_ROUTINE_TOOL: CompiledFirstPartyToolDefinition = {
	kind: CompiledToolDefinitionKinds.FirstParty,
	capability: FirstPartyToolCapabilities.RequestRoutine,
	...FIRST_PARTY_TOOL_CAPABILITY_CONTRACTS[FirstPartyToolCapabilities.RequestRoutine],
	description: "Prepare a routine proposal for human review.",
	parametersSchema: _REQUEST_ROUTINE_PARAMETERS_SCHEMA,
	parametersSchemaDigest: ___DigestCanonicalJson(_REQUEST_ROUTINE_PARAMETERS_SCHEMA),
};
