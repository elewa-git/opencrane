import { describe, expect, it } from "vitest";

import { PersonaArchetypeTones } from "@opencrane/elements/ui";
import { PersonaColours, PersonaModifiers, PersonaOnboardingSnapshot, PersonaOnboardingStates, PersonaResolutionKinds, PersonaResult } from "@opencrane/state/onboarding";

import { _FindCurrentQuestion, _PersonaScores, _ProgressLabel, _ResolutionOptions, _SelectedChoiceLabel } from "../onboarding-view.util";

/** Build one resumable survey snapshot for presentation mapping tests. */
function _Snapshot(): PersonaOnboardingSnapshot
{
	return {
		state: PersonaOnboardingStates.Interview,
		interviewId: "interview-1",
		answeredQuestionCount: 1,
		questionCount: 2,
		personaRevisionId: null,
		questions: [
			{ id: "q1", category: "pace", prompt: "First?", ordinal: 1, choices: [{ id: "a", label: "A", ordinal: 1 }], selectedChoiceId: "a" },
			{ id: "q2", category: "response", prompt: "Second?", ordinal: 2, choices: [{ id: "b", label: "B", ordinal: 1 }], selectedChoiceId: null }
		],
		resolution: null,
		result: null
	};
}

describe("onboarding view mappings", function _OnboardingViewSuite()
{
	it("resumes at the first unanswered reviewed question", function _Resume()
	{
		const snapshot = _Snapshot();
		expect(_FindCurrentQuestion(snapshot)?.id).toBe("q2");
		expect(_ProgressLabel(snapshot)).toBe("Question 2 of 2 · 1 answers saved");
		expect(_SelectedChoiceLabel(snapshot.questions[0])).toBe("A");
	});

	it("offers only server-returned tie candidates", function _TieCandidates()
	{
		expect(_ResolutionOptions({ kind: PersonaResolutionKinds.Primary, candidates: [PersonaColours.Red, PersonaColours.Blue] })).toEqual([
			{ id: "red", label: "Red" },
			{ id: "blue", label: "Blue" }
		]);
	});

	it("rounds only the displayed score vector", function _Scores()
	{
		const result: PersonaResult = {
			displayName: "The Analyst",
			primaryColour: PersonaColours.Blue,
			secondaryColour: PersonaColours.Green,
			modifier: PersonaModifiers.Explorer,
			colourScores: { red: 7, yellow: 3, green: 0, blue: 23, total: 33 },
			opennessScores: { explorer: 6, guardian: 0, total: 6 },
			insights: [],
			instructionPreview: "Prefer evidence-led recommendations."
		};

		expect(_PersonaScores(result)).toEqual([
			{ id: "red", label: "Commander", percentage: 21, tone: PersonaArchetypeTones.Commander },
			{ id: "yellow", label: "Catalyst", percentage: 9, tone: PersonaArchetypeTones.Catalyst },
			{ id: "green", label: "Anchor", percentage: 0, tone: PersonaArchetypeTones.Anchor },
			{ id: "blue", label: "Analyst", percentage: 70, tone: PersonaArchetypeTones.Analyst }
		]);
	});
});
