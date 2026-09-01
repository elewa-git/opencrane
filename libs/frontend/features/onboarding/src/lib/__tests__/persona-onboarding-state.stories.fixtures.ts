import { type PersonaQuestion } from "@opencrane/state/onboarding/projection";

/** Reviewed answer IDs used by the Commander/Guardian story progression. */
const _COMMANDER_GUARDIAN_ANSWERS = ["a", "a", "a", "a", "b", "b", "a", "a", "a", "a"] as const;

/** Builds one reviewed question while deriving the baseline's alphabetical choice IDs. */
function _Question(id: string, category: string, prompt: string, ordinal: number, labels: readonly string[]): PersonaQuestion
{
	return {
		id,
		category,
		prompt,
		ordinal,
		choices: labels.map((label, index) => ({
			id: String.fromCharCode(97 + index),
			label,
			ordinal: index + 1
		})),
		selectedChoiceId: null
	};
}

/**
 * Reviewed `personal-agent-onboarding` v1 questions used by the onboarding state catalogue.
 * @see apps/opencrane/prisma/bootstrap/target-baseline.sql
 */
const _QUESTIONS: readonly PersonaQuestion[] = [
	_Question("q1-decision-speed", "Pace", "When you need to make a decision at work, which feels most natural?", 1, [
		"Decide quickly with the information I have — I can course-correct later.",
		"Take time to consider the options carefully before committing.",
		"Talk it through with someone I trust, then decide together."
	]),
	_Question("q2-response-preference", "Response", "When your assistant gives you an answer, what matters most?", 2, [
		"Get to the point fast — I'll ask if I need more.",
		"Give me the full picture with context and reasoning.",
		"Walk me through it step by step so I can follow along.",
		"Start with the big idea, then I'll dive into details if interested."
	]),
	_Question("q3-feedback-preference", "Feedback", "How do you prefer to receive critical feedback?", 3, [
		"Be direct — tell me what's wrong and how to fix it.",
		"Show me the evidence, then let me draw my own conclusion.",
		"Start with what's working, then raise what needs attention.",
		"Frame it as an opportunity — what could we try differently?"
	]),
	_Question("q4-meeting-energy", "Interaction", "Which describes your ideal interaction with a colleague or assistant?", 4, [
		"Short, focused, outcome-driven — no small talk needed.",
		"Collaborative and energetic — bouncing ideas around.",
		"Calm and supportive — taking time to understand each other.",
		"Structured and thorough — covering everything systematically."
	]),
	_Question("q5-new-ideas", "Openness", "When facing a problem you've solved before, what do you prefer?", 5, [
		"Try a completely new approach — there might be something better.",
		"Use what worked last time — why reinvent the wheel?",
		"Start with the proven method but be open to improvements."
	]),
	_Question("q6-risk-appetite", "Risk", "When your assistant suggests something, would you rather it…", 6, [
		"Suggest the bold, creative option and let me dial it back.",
		"Suggest the safe, proven option and let me push it further.",
		"Present both and explain the trade-offs."
	]),
	_Question("q7-suggestion-cadence", "Initiative", "How proactively should your assistant surface ideas and recommendations?", 7, [
		"Bring me a concrete recommendation without waiting to be asked.",
		"Suggest options when relevant and wait for my decision.",
		"Check whether I want suggestions before expanding the topic.",
		"Surprise me with ideas I hadn't thought of, but let me choose."
	]),
	_Question("q8-challenge-preference", "Challenge", "When you're heading down a path your assistant thinks is wrong, it should…", 8, [
		"Tell me directly — “I think this is a mistake, here's why.”",
		"Ask thoughtful questions that help me see the issue myself.",
		"Present the evidence and the alternative, then let me decide.",
		"Support my direction but flag the risk so I'm informed."
	]),
	_Question("q9-relationship-model", "Relationship", "Which best describes what you want from your assistant?", 9, [
		"A sharp tool — efficient, reliable, no personality needed.",
		"A thinking partner — someone who engages with my ideas.",
		"A trusted advisor — someone who understands my context over time.",
		"A rigorous collaborator — someone who holds me to high standards."
	]),
	_Question("q10-tone-preference", "Tone", "Pick the tone that would make you most comfortable working with an AI assistant every day.", 10, [
		"Confident and direct, like a no-nonsense colleague.",
		"Warm and enthusiastic, like an excited collaborator.",
		"Calm and steady, like a patient mentor.",
		"Precise and thorough, like a meticulous analyst."
	])
];

/**
 * Builds the reviewed question set with the first `answeredQuestionCount` Commander/Guardian choices
 * selected. State stories use the remaining null choices to show resumed progress without creating
 * another survey or scoring implementation.
 */
export function __StoryPersonaQuestions(answeredQuestionCount: number): readonly PersonaQuestion[]
{
	return _QUESTIONS.map((question, index) => ({
		...question,
		choices: question.choices.map(choice => ({ ...choice })),
		selectedChoiceId: index < answeredQuestionCount
			? _COMMANDER_GUARDIAN_ANSWERS[index]!
			: null
	}));
}
