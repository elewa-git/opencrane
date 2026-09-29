import { describe, expect, it } from "vitest";

import { FIRST_PARTY_TOOL_CAPABILITY_CONTRACTS, FirstPartyToolCapabilities } from "../compiled-run-input.types";
import { ___RunInputFirstPartyCapabilitySelectionSchema, ___RunInputFirstPartyCapabilitySelectionsSchema } from "../run-input-first-party-capability.validator";

const _DIGEST = `sha256:${"a".repeat(64)}`;

/** Build one valid coordinate using the declaration owner's current semantic revision. */
function _Selection(capability: FirstPartyToolCapabilities)
{
	return { capability, capabilityRevision: FIRST_PARTY_TOOL_CAPABILITY_CONTRACTS[capability].capabilityRevision, parametersSchemaDigest: _DIGEST };
}

describe("run-input first-party capability validation", function _RunInputFirstPartyCapabilityValidationSuite()
{
	it("accepts the exact closed capability coordinate", function _AcceptsCoordinate()
	{
		expect(___RunInputFirstPartyCapabilitySelectionSchema.parse(_Selection(FirstPartyToolCapabilities.RequestRoutine))).toEqual(_Selection(FirstPartyToolCapabilities.RequestRoutine));
	});

	it.each([
		{ ..._Selection(FirstPartyToolCapabilities.RequestRoutine), capability: "unknown" },
		{ ..._Selection(FirstPartyToolCapabilities.RequestRoutine), capabilityRevision: "opencrane:scheduling:request_routine:v2" },
		{ ..._Selection(FirstPartyToolCapabilities.RequestRoutine), parametersSchemaDigest: "sha256:invalid" },
		{ ..._Selection(FirstPartyToolCapabilities.RequestRoutine), unexpected: true },
	])("rejects malformed or widened coordinates", function _RejectsCoordinate(value)
	{
		expect(___RunInputFirstPartyCapabilitySelectionSchema.safeParse(value).success).toBe(false);
	});

	it("requires a duplicate-free canonical capability order", function _RequiresCanonicalOrder()
	{
		const requestRoutine = _Selection(FirstPartyToolCapabilities.RequestRoutine);
		const upgradeSession = _Selection(FirstPartyToolCapabilities.UpgradeSession);
		const sorted = [requestRoutine, upgradeSession].sort(function _ByCapability(left, right): number { return left.capability < right.capability ? -1 : 1; });

		expect(___RunInputFirstPartyCapabilitySelectionsSchema.safeParse(sorted).success).toBe(true);
		expect(___RunInputFirstPartyCapabilitySelectionsSchema.safeParse([...sorted].reverse()).success).toBe(false);
		expect(___RunInputFirstPartyCapabilitySelectionsSchema.safeParse([requestRoutine, requestRoutine]).success).toBe(false);
	});
});
