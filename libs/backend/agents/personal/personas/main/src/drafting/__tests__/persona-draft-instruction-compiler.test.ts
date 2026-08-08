import { describe, expect, it } from "vitest";

import { _CompilePersonaDraftInstructions } from "../persona-draft-instruction-compiler.js";

/** Complete reviewed interpolation fixture. */
const _VARIABLES = { response_style: "Lead with the conclusion.", feedback_approach: "Present evidence.", challenge_mode: "Name the risk directly.", relationship_frame: "thinking partner", secondary_blend: "Also value precision." };

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
		expect(_CompilePersonaDraftInstructions("{{response_style}}{{feedback_approach}}{{challenge_mode}}{{relationship_frame}}{{secondary_blend}}", { ..._VARIABLES, response_style: "{{unsafe}}" })).toBeNull();
	});
});
