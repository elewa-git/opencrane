import { describe, expect, it } from "vitest";

import { PersonaColourValues } from "../../scoring/persona-scorer.types.js";

import { _DerivePersonaDraftSources } from "../persona-draft-source-deriver.js";
import type { PersonaDraftSourceDerivationInput } from "../persona-draft-source-deriver.types.js";

/** Complete reviewed source snapshot for pure draft-derivation tests. */
function _Input(): PersonaDraftSourceDerivationInput<string>
{
	return {
		questionSetId: "persona-sorter",
		questionSetVersion: 1,
		templateContent: "{{response_style}}\n{{feedback_approach}}\n{{challenge_mode}}\n{{relationship_frame}}\n{{secondary_blend}}",
		interpolationDirectives: {
			byChoice: {
				"q2-response-preference:q2-a": "Lead with the conclusion.",
				"q3-feedback-preference:q3-b": "Present the evidence.",
				"q8-challenge-preference:q8-c": "Name the alternative.",
				"q9-relationship-model:q9-d": "rigorous collaborator",
			},
			secondaryBlend: { red: "Red blend.", yellow: "Yellow blend.", green: "Green blend.", blue: "Blue blend." },
		},
		secondaryColour: PersonaColourValues.Blue,
		answers: [
			{ answerId: "answer-2", questionId: "q2-response-preference", choiceId: "q2-a", choiceLabel: "Get to the point", category: "response" },
			{ answerId: "answer-3", questionId: "q3-feedback-preference", choiceId: "q3-b", choiceLabel: "Show evidence", category: "feedback" },
			{ answerId: "answer-8", questionId: "q8-challenge-preference", choiceId: "q8-c", choiceLabel: "Present the alternative", category: "challenge" },
			{ answerId: "answer-9", questionId: "q9-relationship-model", choiceId: "q9-d", choiceLabel: "Rigorous collaborator", category: "relationship" },
		],
	};
}

describe("_DerivePersonaDraftSources", function _PersonaDraftSourceDeriverSuite()
{
	it("compiles every reviewed coordinate and retains exact insight provenance", function _Derives()
	{
		const result = _DerivePersonaDraftSources(_Input());

		expect(result?.compiledInstructions).toBe("Lead with the conclusion.\nPresent the evidence.\nName the alternative.\nrigorous collaborator\nBlue blend.\n");
		expect(result?.insights).toEqual([
			{ answerId: "answer-2", statement: "Get to the point → Lead with the conclusion.", category: "response", questionSetId: "persona-sorter", questionSetVersion: 1, questionId: "q2-response-preference" },
			{ answerId: "answer-3", statement: "Show evidence → Present the evidence.", category: "feedback", questionSetId: "persona-sorter", questionSetVersion: 1, questionId: "q3-feedback-preference" },
			{ answerId: "answer-8", statement: "Present the alternative → Name the alternative.", category: "challenge", questionSetId: "persona-sorter", questionSetVersion: 1, questionId: "q8-challenge-preference" },
			{ answerId: "answer-9", statement: "Rigorous collaborator → rigorous collaborator", category: "relationship", questionSetId: "persona-sorter", questionSetVersion: 1, questionId: "q9-relationship-model" },
		]);
	});

	it("fails closed when any required answer coordinate is missing", function _MissingCoordinate()
	{
		const input = _Input();
		expect(_DerivePersonaDraftSources({ ...input, answers: input.answers.filter(function _WithoutChallenge(answer) { return answer.questionId !== "q8-challenge-preference"; }) })).toBeNull();
	});

	it("fails closed on malformed directives or an incomplete colour map", function _MalformedDirectives()
	{
		const input = _Input();
		expect(_DerivePersonaDraftSources({ ...input, interpolationDirectives: { byChoice: [], secondaryBlend: {} } })).toBeNull();
		expect(_DerivePersonaDraftSources({ ...input, interpolationDirectives: { ...(input.interpolationDirectives as Record<string, unknown>), secondaryBlend: { red: "Red blend." } } })).toBeNull();
	});

	it("rejects unknown persisted fields instead of silently stripping catalogue drift", function _StrictDirectives()
	{
		const input = _Input();
		const directives = input.interpolationDirectives as { readonly byChoice: Readonly<Record<string, string>>; readonly secondaryBlend: Readonly<Record<string, string>> };

		expect(_DerivePersonaDraftSources({ ...input, interpolationDirectives: { ...directives, unexpectedPolicy: "ignored" } })).toBeNull();
		expect(_DerivePersonaDraftSources({ ...input, interpolationDirectives: { ...directives, secondaryBlend: { ...directives.secondaryBlend, purple: "Unknown blend." } } })).toBeNull();
	});
});
