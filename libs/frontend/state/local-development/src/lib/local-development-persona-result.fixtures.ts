import { PersonaColours, PersonaModifiers, PersonaOnboardingStates, type PersonaOnboardingSnapshot } from "@opencrane/models/user-onboarding";

/** Exact compiled Commander/Guardian instructions produced by the reviewed fixture answers. */
const _LOCAL_COMMANDER_GUARDIAN_INSTRUCTIONS = `You are a direct, results-driven assistant who values speed, clarity, and proven
approaches. You also value precision and evidence-based reasoning on important decisions.

## Communication style

- Lead with the conclusion. Context follows only if asked.
- Keep responses short and actionable — bullets over paragraphs.
- One clear recommendation per decision point. State the trade-off in one line.
- Use plain, confident language. State necessary uncertainty precisely; avoid filler and apology
  preambles.

## Challenge and feedback

- Be direct about what is wrong and how to fix it.
- When the user is heading for trouble, name the risk directly and say “I think this is a mistake — here is why”.
- Respect disagreement — state your case once, clearly, then respect the user's decision.

## Initiative

- Default to proven, well-tested approaches. Flag when something is untested.
- Recommend the reliable option. The user can choose to experiment.
- When something is clearly wrong, flag it immediately rather than waiting to be asked.

## What to avoid

- Never pad responses with reassurance or unnecessary context.
- Never present more than three options — recommend the strongest one.
- Never soften a genuine concern to avoid discomfort.
`;

/**
 * Builds one fixed reviewed Commander/Guardian result while retaining the selected survey answers.
 *
 * Tier 1 exercises the review and approval UI; it does not duplicate the backend scoring authority.
 * The persona gateway admits only the reviewed answer path that produced these fixed values, so the
 * displayed evidence stays consistent with every selected answer.
 */
export function __CreateLocalPersonaReview(questions: PersonaOnboardingSnapshot["questions"]): PersonaOnboardingSnapshot
{
	return {
		state: PersonaOnboardingStates.Review,
		interviewId: "interview-local-1",
		answeredQuestionCount: questions.length,
		questionCount: questions.length,
		personaRevisionId: "persona-revision-local-1",
		questions: questions.map(question => ({
			...question,
			choices: question.choices.map(choice => ({ ...choice }))
		})),
		resolution: null,
		result: {
			displayName: "The Commander (Guardian)",
			primaryColour: PersonaColours.Red,
			secondaryColour: PersonaColours.Blue,
			modifier: PersonaModifiers.Guardian,
			colourScores: {
				red: 22,
				yellow: 3,
				green: 0,
				blue: 8,
				total: 33
			},
			opennessScores: {
				explorer: 0,
				guardian: 6,
				total: 6
			},
			insights: [
				"Get to the point fast — I'll ask if I need more. → Lead with the conclusion. Context follows only if asked.",
				"Be direct — tell me what's wrong and how to fix it. → Be direct about what is wrong and how to fix it.",
				"Tell me directly — “I think this is a mistake, here's why.” → name the risk directly and say “I think this is a mistake — here is why”",
				"A sharp tool — efficient, reliable, no personality needed. → assistant"
			],
			instructionPreview: _LOCAL_COMMANDER_GUARDIAN_INSTRUCTIONS
		}
	};
}

/** Builds the live-shaped review evidence returned before the immutable draft exists. */
export function __CreateLocalPersonaPreDraftReview(questions: PersonaOnboardingSnapshot["questions"]): PersonaOnboardingSnapshot
{
	const review = __CreateLocalPersonaReview(questions);
	return {
		...review,
		personaRevisionId: null,
		result: {
			...review.result!,
			instructionPreview: null
		}
	};
}
