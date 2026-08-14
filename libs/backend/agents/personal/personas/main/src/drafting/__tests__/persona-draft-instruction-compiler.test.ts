import { describe, expect, it } from "vitest";

import { _CompilePersonaDraftInstructions } from "../persona-draft-instruction-compiler";
import { PersonaTemplateVariable, type PersonaTemplateVariables } from "../persona-draft-instruction-compiler.types";

/** Complete reviewed interpolation fixture. */
const _VARIABLES: PersonaTemplateVariables = {
	[PersonaTemplateVariable.ResponseStyle]: "Lead with the conclusion.",
	[PersonaTemplateVariable.FeedbackApproach]: "Present evidence.",
	[PersonaTemplateVariable.ChallengeMode]: "Name the risk directly.",
	[PersonaTemplateVariable.RelationshipFrame]: "thinking partner",
	[PersonaTemplateVariable.SecondaryBlend]: "Also value precision.",
};

describe("_CompilePersonaDraftInstructions", () =>
{
	it("replaces each exact reviewed placeholder once", () =>
	{
		const template = "{{response_style}}\n{{feedback_approach}}\n{{challenge_mode}}\n{{relationship_frame}}\n{{secondary_blend}}";
		expect(_CompilePersonaDraftInstructions(template, _VARIABLES)).toBe("Lead with the conclusion.\nPresent evidence.\nName the risk directly.\nthinking partner\nAlso value precision.\n");
	});

	it("fails closed on missing, duplicate, unknown, or unresolved placeholders", () =>
	{
		expect(_CompilePersonaDraftInstructions("{{response_style}}", _VARIABLES)).toBeNull();
		expect(_CompilePersonaDraftInstructions("{{response_style}}{{response_style}}{{feedback_approach}}{{challenge_mode}}{{relationship_frame}}", _VARIABLES)).toBeNull();
		expect(_CompilePersonaDraftInstructions("{{response_style}}{{feedback_approach}}{{challenge_mode}}{{relationship_frame}}{{unknown}}", _VARIABLES)).toBeNull();
		expect(_CompilePersonaDraftInstructions("{{response_style}}{{feedback_approach}}{{challenge_mode}}{{relationship_frame}}{{secondary_blend}}", { ..._VARIABLES, [PersonaTemplateVariable.ResponseStyle]: "{{unsafe}}" })).toBeNull();
	});
});
