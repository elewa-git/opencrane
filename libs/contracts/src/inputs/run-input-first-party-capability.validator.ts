import { z } from "zod";

import { FIRST_PARTY_TOOL_CAPABILITY_CONTRACTS, FirstPartyToolCapabilities } from "./compiled-run-input.types";
import type { RunInputFirstPartyCapabilitySelection } from "./run-input-first-party-capability.types";

/** Validates one server-selected built-in capability before it crosses a storage boundary. */
export const ___RunInputFirstPartyCapabilitySelectionSchema: z.ZodType<RunInputFirstPartyCapabilitySelection> = z.object({
	capability: z.nativeEnum(FirstPartyToolCapabilities),
	capabilityRevision: z.string().min(1),
	parametersSchemaDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
}).strict().superRefine(function _MatchesCapabilityRevision(value, context): void
{
	if (value.capabilityRevision !== FIRST_PARTY_TOOL_CAPABILITY_CONTRACTS[value.capability].capabilityRevision)
		context.addIssue({ code: z.ZodIssueCode.custom, message: "First-party capability revision does not match its declaration contract" });
});

/** Validates one duplicate-free capability array in stable capability order. */
export const ___RunInputFirstPartyCapabilitySelectionsSchema: z.ZodType<readonly RunInputFirstPartyCapabilitySelection[]> = z.array(___RunInputFirstPartyCapabilitySelectionSchema).max(Object.keys(FirstPartyToolCapabilities).length).superRefine(function _CanonicalSelections(values, context): void
{
	for (let index = 0; index < values.length; index += 1)
	{
		const previous = values[index - 1];
		if (previous !== undefined && previous.capability >= values[index]!.capability)
		{
			context.addIssue({ code: z.ZodIssueCode.custom, message: "First-party capability selections must be unique and canonically ordered" });
			return;
		}
	}
});
