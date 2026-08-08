import { describe, expect, it } from "vitest";

import { PersonaArchetypeTones } from "@opencrane/elements/ui";

import { _PersonaFirstChatAnswerIntent, _PersonaFirstChatArchetypeClass } from "../persona-first-chat.component.js";
import { PersonaFirstChatArchetypeClasses, type PersonaFirstChatQuestion, PersonaFirstChatStates } from "../persona-first-chat.types.js";

/** All three canonical ordinals used to prove one typed sequential component contract. */
const _QUESTIONS: readonly PersonaFirstChatQuestion[] =
[
	{ id: "question-one", ordinal: 1, prompt: "First question" },
	{ id: "question-two", ordinal: 2, prompt: "Second question" },
	{ id: "question-three", ordinal: 3, prompt: "Third question" }
];

describe("PersonaFirstChatComponent presentation contract", function _PersonaFirstChatContractSuite()
{
	it("maps Commander, Catalyst, Anchor, and Analyst through one finite visual owner", function _ArchetypeMapping()
	{
		const mappings: readonly [PersonaArchetypeTones, PersonaFirstChatArchetypeClasses][] =
		[
			[PersonaArchetypeTones.Commander, PersonaFirstChatArchetypeClasses.Commander],
			[PersonaArchetypeTones.Catalyst, PersonaFirstChatArchetypeClasses.Catalyst],
			[PersonaArchetypeTones.Anchor, PersonaFirstChatArchetypeClasses.Anchor],
			[PersonaArchetypeTones.Analyst, PersonaFirstChatArchetypeClasses.Analyst]
		];

		for (const [archetype, expectedClass] of mappings)
		{
			expect(_PersonaFirstChatArchetypeClass(archetype)).toBe(expectedClass);
		}
	});

	it("builds the same trimmed answer intent for each of the three sequential questions", function _ThreeQuestionEquivalence()
	{
		const intents = _QUESTIONS.map((question) => _PersonaFirstChatAnswerIntent(question, PersonaFirstChatStates.AwaitingCalibration, `  Answer ${question.ordinal}  `));

		expect(intents).toEqual(
		[
			{ questionId: "question-one", answer: "Answer 1" },
			{ questionId: "question-two", answer: "Answer 2" },
			{ questionId: "question-three", answer: "Answer 3" }
		]);
	});

	it("returns no intent for empty, questionless, or externally blocked lifecycle states", function _ExternallyOwnedLifecycle()
	{
		expect(_PersonaFirstChatAnswerIntent(_QUESTIONS[0], PersonaFirstChatStates.AwaitingCalibration, "   ")).toBeNull();
		expect(_PersonaFirstChatAnswerIntent(null, PersonaFirstChatStates.AwaitingCalibration, "Answer")).toBeNull();

		const blockedStates = [PersonaFirstChatStates.Submitting, PersonaFirstChatStates.Reconnecting, PersonaFirstChatStates.Completed, PersonaFirstChatStates.Error];
		for (const state of blockedStates)
		{
			expect(_PersonaFirstChatAnswerIntent(_QUESTIONS[0], state, "Answer")).toBeNull();
		}
	});
});
