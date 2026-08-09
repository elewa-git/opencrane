import { describe, expect, it } from "vitest";

import { PersonaColourValues, PersonaModifierValues, PersonaTieKinds } from "../persona-scorer.types.js";
import { _ParsePersonaPersistedScoreEvidence } from "../persona-scorer.validator.js";

/** Build one valid immutable score-evidence document. */
function _Evidence()
{
	return {
		orderedAnswerIds: ["answer-1"],
		orderedChoiceIds: ["question-1:a"],
		colours: { red: 2, yellow: 1, green: 0, blue: 2, total: 5 },
		openness: { explorer: 1, guardian: 0, total: 1 },
		tieResolutions: [{ kind: PersonaTieKinds.Primary, candidates: [PersonaColourValues.Red, PersonaColourValues.Blue], selectedValue: PersonaColourValues.Blue }],
		primary: PersonaColourValues.Blue,
		secondary: PersonaColourValues.Red,
		modifier: PersonaModifierValues.Explorer,
	};
}

describe("persona persisted score evidence validation", function _Suite()
{
	it("accepts one exact resolved score document", function _AcceptsEvidence()
	{
		expect(_ParsePersonaPersistedScoreEvidence(_Evidence())).toEqual(_Evidence());
	});

	it("rejects malformed score totals before owner-visible projection", function _RejectsFalseTotals()
	{
		expect(_ParsePersonaPersistedScoreEvidence({ ..._Evidence(), colours: { ..._Evidence().colours, total: 99 } })).toBeNull();
	});

	it("rejects a tie selection outside its immutable candidate set", function _RejectsForgedTieSelection()
	{
		expect(_ParsePersonaPersistedScoreEvidence({ ..._Evidence(), tieResolutions: [{ kind: PersonaTieKinds.Primary, candidates: [PersonaColourValues.Red, PersonaColourValues.Blue], selectedValue: PersonaColourValues.Green }] })).toBeNull();
	});

	it("rejects candidates that do not match their governed tie boundary", function _RejectsWrongCandidateKind()
	{
		expect(_ParsePersonaPersistedScoreEvidence({ ..._Evidence(), tieResolutions: [{ kind: PersonaTieKinds.Modifier, candidates: [PersonaColourValues.Red, PersonaColourValues.Blue], selectedValue: PersonaColourValues.Blue }] })).toBeNull();
	});

	it("rejects classifications that contradict the authoritative score replay", function _RejectsContradictoryClassification()
	{
		expect(_ParsePersonaPersistedScoreEvidence({ ..._Evidence(), primary: PersonaColourValues.Red, secondary: PersonaColourValues.Blue })).toBeNull();
	});

	it("rejects duplicate tie boundaries absent from durable storage", function _RejectsDuplicateTieKind()
	{
		const resolution = _Evidence().tieResolutions[0]!;
		expect(_ParsePersonaPersistedScoreEvidence({ ..._Evidence(), tieResolutions: [resolution, { ...resolution, selectedValue: PersonaColourValues.Red }] })).toBeNull();
	});
});
