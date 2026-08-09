import { describe, expect, it } from "vitest";

import { PersonaColours, PersonaModifiers, PersonaOnboardingStates, type PersonaOnboardingSnapshot } from "../persona-gateway.types";
import { _ParsePersonaOnboardingSnapshot } from "../persona-gateway.validator";

/** Build one API-aligned review snapshot for bounded validator regressions. */
function _Snapshot(): PersonaOnboardingSnapshot
{
	return {
		state: PersonaOnboardingStates.Review,
		interviewId: "interview-1",
		answeredQuestionCount: 1,
		questionCount: 1,
		personaRevisionId: "revision-1",
		questions: [{ id: "question-1", category: "pace", prompt: "How should we work?", ordinal: 1, choices: [{ id: "choice-1", label: "Directly", ordinal: 1 }, { id: "choice-2", label: "Deliberately", ordinal: 2 }], selectedChoiceId: "choice-1" }],
		resolution: null,
		result: {
			displayName: "The Commander",
			primaryColour: PersonaColours.Red,
			secondaryColour: PersonaColours.Blue,
			modifier: PersonaModifiers.Explorer,
			colourScores: { red: 1, yellow: 0, green: 0, blue: 1, total: 2 },
			opennessScores: { explorer: 1, guardian: 0, total: 1 },
			insights: ["You prefer direct recommendations."],
			instructionPreview: "Lead with the conclusion.",
		},
	};
}

describe("_ParsePersonaOnboardingSnapshot", function _PersonaGatewayValidatorSuite()
{
	it("accepts one-based ordinals, two reviewed choices, and no more than five insights", function _AcceptsApiBounds()
	{
		const snapshot = _Snapshot();
		expect(_ParsePersonaOnboardingSnapshot(snapshot)).toEqual(snapshot);
	});

	it("rejects a zero-based question ordinal", function _RejectsQuestionOrdinal()
	{
		const snapshot = _Snapshot();
		const invalid = { ...snapshot, questions: [{ ...snapshot.questions[0]!, ordinal: 0 }] };
		expect(function _ParseInvalid() { _ParsePersonaOnboardingSnapshot(invalid); }).toThrow("invalid onboarding projection");
	});

	it("rejects a zero-based choice ordinal", function _RejectsChoiceOrdinal()
	{
		const snapshot = _Snapshot();
		const question = snapshot.questions[0]!;
		const invalid = { ...snapshot, questions: [{ ...question, choices: [{ ...question.choices[0]!, ordinal: 0 }, question.choices[1]!] }] };
		expect(function _ParseInvalid() { _ParsePersonaOnboardingSnapshot(invalid); }).toThrow("invalid onboarding projection");
	});

	it("rejects a question with fewer than two reviewed choices", function _RejectsSingleChoice()
	{
		const snapshot = _Snapshot();
		const question = snapshot.questions[0]!;
		const invalid = { ...snapshot, questions: [{ ...question, choices: [question.choices[0]!] }] };
		expect(function _ParseInvalid() { _ParsePersonaOnboardingSnapshot(invalid); }).toThrow("invalid onboarding projection");
	});

	it("rejects more than five review insights", function _RejectsInsightOverflow()
	{
		const snapshot = _Snapshot();
		const invalid = { ...snapshot, result: { ...snapshot.result, insights: ["One", "Two", "Three", "Four", "Five", "Six"] } };
		expect(function _ParseInvalid() { _ParsePersonaOnboardingSnapshot(invalid); }).toThrow("invalid onboarding projection");
	});

	it("rejects zero score denominators forbidden by the API contract", function _RejectsZeroDenominators()
	{
		const snapshot = _Snapshot();
		const invalid = { ...snapshot, result: { ...snapshot.result, colourScores: { red: 0, yellow: 0, green: 0, blue: 0, total: 0 }, opennessScores: { explorer: 0, guardian: 0, total: 0 } } };
		expect(function _ParseInvalid() { _ParsePersonaOnboardingSnapshot(invalid); }).toThrow("invalid onboarding projection");
	});
});
