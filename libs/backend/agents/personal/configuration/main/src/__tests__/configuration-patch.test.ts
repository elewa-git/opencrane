import { describe, expect, it } from "vitest";
import { AgentConfigPatchKinds } from "@opencrane/contracts";

import { _IsPersonalConfigurationPatch } from "../configuration-patch.js";

describe("personal configuration patch validation", function _Suite()
{
	it("retains the persisted and public schema spellings", function _RetainsSerializedValues()
	{
		expect(AgentConfigPatchKinds.PersonaRefresh).toBe("persona_refresh");
		expect(AgentConfigPatchKinds.ModelAlias).toBe("model_alias");
	});

	it("accepts every documented patch kind through its enum member", function _AcceptsKnownKinds()
	{
		expect(_IsPersonalConfigurationPatch({ kind: AgentConfigPatchKinds.PersonaRefresh })).toBe(true);
		expect(_IsPersonalConfigurationPatch({ kind: AgentConfigPatchKinds.ModelAlias, modelAlias: "careful-model" })).toBe(true);
	});

	it("rejects unknown discriminants and extra configuration authority", function _RejectsUnknownKind()
	{
		expect(_IsPersonalConfigurationPatch({ kind: "replace_everything" })).toBe(false);
		expect(_IsPersonalConfigurationPatch({ kind: AgentConfigPatchKinds.PersonaRefresh, soul: "unreviewed" })).toBe(false);
	});
});
