import { describe, expect, it } from "vitest";

import { _ScorePersona } from "../persona-scorer.js";
import { PersonaColourValues, PersonaModifierValues, PersonaTieKinds, type PersonaWeightedAnswer } from "../persona-scorer.types.js";

/** Build one reviewed answer weight fixture. */
function _Answer(questionId: string, weights: Partial<Pick<PersonaWeightedAnswer, "red" | "yellow" | "green" | "blue" | "explorer" | "guardian">>): PersonaWeightedAnswer
{
	return { answerId: `answer-${questionId}`, questionId, choiceId: "a", red: 0, yellow: 0, green: 0, blue: 0, explorer: 0, guardian: 0, ...weights };
}

describe("_ScorePersona", () =>
{
	it("retains exact counters and selects Commander Blue Explorer", () =>
	{
		const answers = [
			_Answer("q1", { red: 3, yellow: 2 }), _Answer("q2", { red: 3, blue: 1 }),
			_Answer("q3", { red: 3, blue: 1 }), _Answer("q4", { red: 3, blue: 2 }),
			_Answer("q5", { explorer: 3 }), _Answer("q6", { explorer: 3, red: 1 }),
			_Answer("q7", { red: 2, yellow: 1 }), _Answer("q8", { red: 3, blue: 1 }),
			_Answer("q9", { red: 2, blue: 2 }), _Answer("q10", { red: 3 }),
		];
		const result = _ScorePersona(answers, []);
		expect(result).toMatchObject({ colours: { red: 23, yellow: 3, green: 0, blue: 7, total: 33 }, openness: { explorer: 6, guardian: 0, total: 6 }, primary: PersonaColourValues.Red, secondary: PersonaColourValues.Blue, modifier: PersonaModifierValues.Explorer, resolutionRequired: null });
		expect(result?.candidateEvidence).toEqual({ primary: [PersonaColourValues.Red], secondary: [PersonaColourValues.Blue], modifier: [PersonaModifierValues.Explorer] });
	});

	it("requires exact primary, secondary, and modifier tie evidence", () =>
	{
		const primaryAnswers = [_Answer("q1", { red: 2, blue: 2, yellow: 1, explorer: 1, guardian: 1 })];
		const primary = _ScorePersona(primaryAnswers, []);
		expect(primary?.resolutionRequired).toEqual({ kind: PersonaTieKinds.Primary, candidates: [PersonaColourValues.Red, PersonaColourValues.Blue] });
		expect(primary?.candidateEvidence).toEqual({ primary: [PersonaColourValues.Red, PersonaColourValues.Blue], secondary: [], modifier: [] });
		const secondaryAnswers = [_Answer("q1", { red: 3, yellow: 2, blue: 2, explorer: 1, guardian: 1 })];
		const secondary = _ScorePersona(secondaryAnswers, []);
		expect(secondary?.resolutionRequired).toEqual({ kind: PersonaTieKinds.Secondary, candidates: [PersonaColourValues.Yellow, PersonaColourValues.Blue] });
		expect(secondary?.candidateEvidence).toEqual({ primary: [PersonaColourValues.Red], secondary: [PersonaColourValues.Yellow, PersonaColourValues.Blue], modifier: [] });
		const modifier = _ScorePersona(secondaryAnswers, [{ kind: PersonaTieKinds.Secondary, candidates: ["yellow", "blue"], selectedValue: "blue" }]);
		expect(modifier?.resolutionRequired).toEqual({ kind: PersonaTieKinds.Modifier, candidates: [PersonaModifierValues.Explorer, PersonaModifierValues.Guardian] });
	});

	it("rejects stale candidate sets and invalid weights", () =>
	{
		const tied = [_Answer("q1", { red: 1, blue: 1, explorer: 1 })];
		expect(_ScorePersona(tied, [{ kind: PersonaTieKinds.Primary, candidates: ["blue", "red"], selectedValue: "red" }])?.primary).toBeNull();
		expect(_ScorePersona([_Answer("q1", { red: -1, explorer: 1 })], [])).toBeNull();
	});
});
