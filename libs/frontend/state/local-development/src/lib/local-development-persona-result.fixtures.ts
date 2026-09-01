import { PersonaModifiers, PersonaOnboardingStates, type PersonaOnboardingSnapshot } from "@opencrane/models/user-onboarding";

import { __LocalDevelopmentInsights } from "./local-development-archetype.fixtures";
import type { LocalDevelopmentArchetypeFixture } from "./local-development-archetype.types";

/**
 * Build one reviewed Guardian result while retaining the selected survey answers.
 *
 * Tier 1 exercises the review and approval UI; it does not duplicate the backend scoring authority.
 * Every supported archetype uses precomputed score evidence and compiled content from the reviewed
 * database sources, so the displayed result remains consistent with its admitted answer path.
 */
export function __CreateLocalPersonaReview(questions: PersonaOnboardingSnapshot["questions"], fixture: LocalDevelopmentArchetypeFixture): PersonaOnboardingSnapshot
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
			displayName: fixture.displayName,
			primaryColour: fixture.primaryColour,
			secondaryColour: fixture.secondaryColour,
			modifier: PersonaModifiers.Guardian,
			colourScores: fixture.colourScores,
			opennessScores: fixture.opennessScores,
			insights: __LocalDevelopmentInsights([...questions], fixture),
			instructionPreview: fixture.instructionPreview
		}
	};
}

/** Build live-shaped review evidence before the immutable local draft exists. */
export function __CreateLocalPersonaPreDraftReview(questions: PersonaOnboardingSnapshot["questions"], fixture: LocalDevelopmentArchetypeFixture): PersonaOnboardingSnapshot
{
	const review = __CreateLocalPersonaReview(questions, fixture);
	return {
		...review,
		personaRevisionId: null,
		result: {
			...review.result!,
			instructionPreview: null
		}
	};
}
