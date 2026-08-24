import { describe, expect, it } from "vitest";

import { PersonaColours, PersonaModifiers, PersonaOnboardingStates, type PersonaOnboardingSnapshot } from "../persona-onboarding.types";
import { ___ParsePersonaOnboardingSnapshot } from "../persona-onboarding.validator";

/** Builds one API-aligned review snapshot for validator regressions. */
function _Snapshot(): PersonaOnboardingSnapshot
{
	return {
		state: PersonaOnboardingStates.Review,
		interviewId: "interview-1",
		answeredQuestionCount: 1,
		questionCount: 1,
		personaRevisionId: "revision-1",
		questions: [
			{
				id: "question-1",
				category: "pace",
				prompt: "How should we work?",
				ordinal: 1,
				choices: [
					{
						id: "choice-1",
						label: "Directly",
						ordinal: 1
					},
					{
						id: "choice-2",
						label: "Deliberately",
						ordinal: 2
					}
				],
				selectedChoiceId: "choice-1"
			}
		],
		resolution: null,
		result: {
			displayName: "The Commander (Guardian)",
			primaryColour: PersonaColours.Red,
			secondaryColour: PersonaColours.Blue,
			modifier: PersonaModifiers.Guardian,
			colourScores: {
				red: 1,
				yellow: 0,
				green: 0,
				blue: 1,
				total: 2
			},
			opennessScores: {
				explorer: 0,
				guardian: 1,
				total: 1
			},
			insights: ["You prefer direct recommendations."],
			instructionPreview: "Lead with the conclusion."
		}
	};
}

describe("___ParsePersonaOnboardingSnapshot", function _PersonaOnboardingValidatorSuite()
{
	it("accepts reviewed questions, choices, and up to five insights", function _AcceptsApiBounds()
	{
		const snapshot = _Snapshot();
		expect(___ParsePersonaOnboardingSnapshot(snapshot)).toEqual(snapshot);
	});

	it("rejects a zero-based question ordinal", function _RejectsQuestionOrdinal()
	{
		const snapshot = _Snapshot();
		const invalid = {
			...snapshot,
			questions: [
				{
					...snapshot.questions[0]!,
					ordinal: 0
				}
			]
		};
		expect(function _ParseInvalid()
		{
			___ParsePersonaOnboardingSnapshot(invalid);
		}).toThrow("invalid onboarding projection");
	});

	it("rejects a choice that does not belong to the question", function _RejectsUnknownChoice()
	{
		const snapshot = _Snapshot();
		const invalid = {
			...snapshot,
			questions: [
				{
					...snapshot.questions[0]!,
					selectedChoiceId: "missing-choice"
				}
			]
		};
		expect(function _ParseInvalid()
		{
			___ParsePersonaOnboardingSnapshot(invalid);
		}).toThrow("invalid onboarding projection");
	});

	it("rejects more than five review insights", function _RejectsInsightOverflow()
	{
		const snapshot = _Snapshot();
		const invalid = {
			...snapshot,
			result: {
				...snapshot.result!,
				insights: ["One", "Two", "Three", "Four", "Five", "Six"]
			}
		};
		expect(function _ParseInvalid()
		{
			___ParsePersonaOnboardingSnapshot(invalid);
		}).toThrow("invalid onboarding projection");
	});

	it("rejects zero score denominators", function _RejectsZeroDenominators()
	{
		const snapshot = _Snapshot();
		const invalid = {
			...snapshot,
			result: {
				...snapshot.result!,
				colourScores: {
					red: 0,
					yellow: 0,
					green: 0,
					blue: 0,
					total: 0
				},
				opennessScores: {
					explorer: 0,
					guardian: 0,
					total: 0
				}
			}
		};
		expect(function _ParseInvalid()
		{
			___ParsePersonaOnboardingSnapshot(invalid);
		}).toThrow("invalid onboarding projection");
	});

	it("rejects compiled instructions before an immutable persona revision exists", function _RejectsPrematureInstructions()
	{
		const snapshot = _Snapshot();
		const invalid = {
			...snapshot,
			personaRevisionId: null
		};
		expect(function _ParseInvalid()
		{
			___ParsePersonaOnboardingSnapshot(invalid);
		}).toThrow("invalid onboarding projection");
	});
});
