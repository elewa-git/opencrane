import { PersonaFirstChatArchetypes } from "@opencrane/models/user-onboarding";
import { type PersonaQuestion } from "@opencrane/state/onboarding";

import type { _LocalDevelopmentScoringWeight } from "./local-development.scoring.types";

/** Builds one reviewed question with the exact version-one choice labels. */
function _Question(id: string, category: string, prompt: string, ordinal: number, labels: readonly string[]): PersonaQuestion
{
	return { id, category, prompt, ordinal, selectedChoiceId: null, choices: labels.map(function _Choice(label, choiceIndex) { return { id: String.fromCharCode(97 + choiceIndex), label, ordinal: choiceIndex + 1 }; }) };
}

/** Returns a fresh copy of the complete reviewed version-one interview. */
export function _CreateLocalDevelopmentQuestions(): readonly PersonaQuestion[]
{
	return [
		_Question("q1-decision-speed", "Pace", "When you need to make a decision at work, which feels most natural?", 1, ["Decide quickly with the information I have — I can course-correct later.", "Take time to consider the options carefully before committing.", "Talk it through with someone I trust, then decide together."]),
		_Question("q2-response-preference", "Response", "When your assistant gives you an answer, what matters most?", 2, ["Get to the point fast — I'll ask if I need more.", "Give me the full picture with context and reasoning.", "Walk me through it step by step so I can follow along.", "Start with the big idea, then I'll dive into details if interested."]),
		_Question("q3-feedback-preference", "Feedback", "How do you prefer to receive critical feedback?", 3, ["Be direct — tell me what's wrong and how to fix it.", "Show me the evidence, then let me draw my own conclusion.", "Start with what's working, then raise what needs attention.", "Frame it as an opportunity — what could we try differently?"]),
		_Question("q4-meeting-energy", "Interaction", "Which describes your ideal interaction with a colleague or assistant?", 4, ["Short, focused, outcome-driven — no small talk needed.", "Collaborative and energetic — bouncing ideas around.", "Calm and supportive — taking time to understand each other.", "Structured and thorough — covering everything systematically."]),
		_Question("q5-new-ideas", "Openness", "When facing a problem you've solved before, what do you prefer?", 5, ["Try a completely new approach — there might be something better.", "Use what worked last time — why reinvent the wheel?", "Start with the proven method but be open to improvements."]),
		_Question("q6-risk-appetite", "Risk", "When your assistant suggests something, would you rather it…", 6, ["Suggest the bold, creative option and let me dial it back.", "Suggest the safe, proven option and let me push it further.", "Present both and explain the trade-offs."]),
		_Question("q7-suggestion-cadence", "Initiative", "How proactively should your assistant surface ideas and recommendations?", 7, ["Bring me a concrete recommendation without waiting to be asked.", "Suggest options when relevant and wait for my decision.", "Check whether I want suggestions before expanding the topic.", "Surprise me with ideas I hadn't thought of, but let me choose."]),
		_Question("q8-challenge-preference", "Challenge", "When you're heading down a path your assistant thinks is wrong, it should…", 8, ["Tell me directly — “I think this is a mistake, here's why.”", "Ask thoughtful questions that help me see the issue myself.", "Present the evidence and the alternative, then let me decide.", "Support my direction but flag the risk so I'm informed."]),
		_Question("q9-relationship-model", "Relationship", "Which best describes what you want from your assistant?", 9, ["A sharp tool — efficient, reliable, no personality needed.", "A thinking partner — someone who engages with my ideas.", "A trusted advisor — someone who understands my context over time.", "A rigorous collaborator — someone who holds me to high standards."]),
		_Question("q10-tone-preference", "Tone", "Pick the tone that would make you most comfortable working with an AI assistant every day.", 10, ["Confident and direct, like a no-nonsense colleague.", "Warm and enthusiastic, like an excited collaborator.", "Calm and steady, like a patient mentor.", "Precise and thorough, like a meticulous analyst."])
	];
}

/** Expands a compact baseline row into named counters. */
function _Weight(values: readonly [number, number, number, number, number, number]): _LocalDevelopmentScoringWeight
{
	return { red: values[0], yellow: values[1], green: values[2], blue: values[3], explorer: values[4], guardian: values[5] };
}

/** Exact version-one weights from the reviewed clean target baseline. */
export const _LOCAL_DEVELOPMENT_SCORING_WEIGHTS: Readonly<Record<string, _LocalDevelopmentScoringWeight>> =
{
	"q1-decision-speed:a": _Weight([3, 2, 0, 0, 0, 0]), "q1-decision-speed:b": _Weight([0, 0, 2, 3, 0, 0]), "q1-decision-speed:c": _Weight([0, 2, 3, 0, 0, 0]),
	"q2-response-preference:a": _Weight([3, 0, 0, 1, 0, 0]), "q2-response-preference:b": _Weight([0, 0, 1, 3, 0, 0]), "q2-response-preference:c": _Weight([0, 1, 3, 0, 0, 0]), "q2-response-preference:d": _Weight([1, 3, 0, 0, 0, 0]),
	"q3-feedback-preference:a": _Weight([3, 0, 0, 1, 0, 0]), "q3-feedback-preference:b": _Weight([1, 0, 0, 3, 0, 0]), "q3-feedback-preference:c": _Weight([0, 2, 3, 0, 0, 0]), "q3-feedback-preference:d": _Weight([0, 3, 1, 0, 0, 0]),
	"q4-meeting-energy:a": _Weight([3, 0, 0, 2, 0, 0]), "q4-meeting-energy:b": _Weight([1, 3, 0, 0, 0, 0]), "q4-meeting-energy:c": _Weight([0, 1, 3, 0, 0, 0]), "q4-meeting-energy:d": _Weight([0, 0, 1, 3, 0, 0]),
	"q5-new-ideas:a": _Weight([0, 0, 0, 0, 3, 0]), "q5-new-ideas:b": _Weight([0, 0, 0, 0, 0, 3]), "q5-new-ideas:c": _Weight([0, 0, 0, 0, 1, 1]),
	"q6-risk-appetite:a": _Weight([1, 0, 0, 0, 3, 0]), "q6-risk-appetite:b": _Weight([0, 0, 0, 1, 0, 3]), "q6-risk-appetite:c": _Weight([0, 0, 0, 1, 1, 1]),
	"q7-suggestion-cadence:a": _Weight([2, 1, 0, 0, 0, 0]), "q7-suggestion-cadence:b": _Weight([0, 0, 1, 2, 0, 0]), "q7-suggestion-cadence:c": _Weight([0, 0, 2, 1, 0, 0]), "q7-suggestion-cadence:d": _Weight([0, 2, 0, 0, 1, 0]),
	"q8-challenge-preference:a": _Weight([3, 0, 0, 1, 0, 0]), "q8-challenge-preference:b": _Weight([0, 2, 2, 0, 0, 0]), "q8-challenge-preference:c": _Weight([0, 0, 1, 3, 0, 0]), "q8-challenge-preference:d": _Weight([0, 1, 3, 0, 0, 0]),
	"q9-relationship-model:a": _Weight([2, 0, 0, 2, 0, 0]), "q9-relationship-model:b": _Weight([0, 3, 0, 0, 1, 0]), "q9-relationship-model:c": _Weight([0, 0, 3, 1, 0, 0]), "q9-relationship-model:d": _Weight([2, 0, 0, 2, 0, 0]),
	"q10-tone-preference:a": _Weight([3, 0, 0, 0, 0, 0]), "q10-tone-preference:b": _Weight([0, 3, 0, 0, 0, 0]), "q10-tone-preference:c": _Weight([0, 0, 3, 0, 0, 0]), "q10-tone-preference:d": _Weight([0, 0, 0, 3, 0, 0])
};

/** Reviewed answers used to project each named command without inventing a fifth archetype. */
export const _LOCAL_DEVELOPMENT_NAMED_SELECTIONS: Readonly<Record<PersonaFirstChatArchetypes, readonly string[]>> =
{
	[PersonaFirstChatArchetypes.Commander]: ["a", "a", "a", "a", "a", "a", "a", "a", "a", "a"],
	[PersonaFirstChatArchetypes.Catalyst]: ["c", "d", "d", "b", "a", "a", "d", "d", "b", "b"],
	[PersonaFirstChatArchetypes.Anchor]: ["c", "c", "c", "c", "b", "b", "c", "d", "c", "c"],
	[PersonaFirstChatArchetypes.Analyst]: ["b", "b", "b", "d", "b", "b", "b", "c", "d", "d"]
};

/** Applies a reviewed named selection to a fresh interview copy. */
export function _CreateLocalDevelopmentNamedQuestions(archetype: PersonaFirstChatArchetypes): readonly PersonaQuestion[]
{
	const selections = _LOCAL_DEVELOPMENT_NAMED_SELECTIONS[archetype];
	return _CreateLocalDevelopmentQuestions().map(function _Select(question, index) { return { ...question, selectedChoiceId: selections[index] ?? null }; });
}
