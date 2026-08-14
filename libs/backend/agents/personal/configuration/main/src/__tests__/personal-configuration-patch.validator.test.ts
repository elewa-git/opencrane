import { AgentConfigPatchKinds } from "@opencrane/contracts";
import { describe, expect, it } from "vitest";

import { _IsPersonalConfigurationPatch } from "../proposal/personal-configuration-patch.validator";

/** Malformed patch values rejected by every proposal, replay, and materialisation consumer. */
const _INVALID_PATCHES = [
	{ label: "null", value: null },
	{ label: "an array", value: [] },
	{ label: "an unknown kind", value: { kind: "budget" } },
	{ label: "a blank model alias", value: { kind: AgentConfigPatchKinds.ModelAlias, modelAlias: "   " } },
	{ label: "an overlong model alias", value: { kind: AgentConfigPatchKinds.ModelAlias, modelAlias: "a".repeat(201) } },
	{ label: "an extra persona-refresh field", value: { kind: AgentConfigPatchKinds.PersonaRefresh, modelAlias: "unexpected" } },
	{ label: "an extra model-alias field", value: { kind: AgentConfigPatchKinds.ModelAlias, modelAlias: "careful-model", budget: 10 } },
];

describe("personal configuration patch validation", function _PersonalConfigurationPatchValidatorSuite()
{
	it("accepts every closed patch variant", function _AcceptsPatchVariants()
	{
		expect(_IsPersonalConfigurationPatch({ kind: AgentConfigPatchKinds.PersonaRefresh })).toBe(true);
		expect(_IsPersonalConfigurationPatch({ kind: AgentConfigPatchKinds.ModelAlias, modelAlias: "careful-model" })).toBe(true);
	});

	it.each(_INVALID_PATCHES)("rejects $label", function _RejectsInvalidPatch(testCase)
	{
		expect(_IsPersonalConfigurationPatch(testCase.value)).toBe(false);
	});
});
