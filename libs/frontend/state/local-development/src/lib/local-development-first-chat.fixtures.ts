import { PersonaFirstChatArchetypes, PersonaFirstChatColours, UserOnboardingRouteStates, type PersonaFirstChatSnapshot } from "@opencrane/models/user-onboarding";

/** Exact Commander opening pinned by the reviewed first-session source. */
export const LOCAL_COMMANDER_FIRST_CHAT_OPENING = `I'm your personal assistant. Based on your onboarding answers, I'm set up to be direct,
concise, and results-focused. I'll give you straight answers, challenge you when I see a better
path, and skip the filler.

Before we start working: three quick things I need from you to be effective.`;

/** Exact Commander calibration prompts in their reviewed source order. */
export const LOCAL_COMMANDER_FIRST_CHAT_QUESTIONS: readonly string[] = [
	"What are you working on right now?",
	"What is the one thing that wastes your time most?",
	"When I push back on your ideas, how hard should I push?"
];

/**
 * Builds the pending first-chat projection installed after local persona approval.
 *
 * Identity, source label, digest, opening, and prompts mirror the reviewed Commander source used by
 * live onboarding.
 * @see docs/design/persona-archetypes/bootstrap-commander.md
 */
export function __CreateLocalPendingFirstChat(): PersonaFirstChatSnapshot
{
	return {
		workflowVersion: 1,
		state: UserOnboardingRouteStates.BootstrapChatPending,
		conversationId: null,
		persona: {
			revisionId: "persona-revision-local-1",
			displayName: "The Commander (Guardian)",
			archetype: PersonaFirstChatArchetypes.Commander,
			primaryColour: PersonaFirstChatColours.Red
		},
		contentRevision: {
			id: "bootstrap-commander-v1",
			digest: "sha256:53fbb48eb4fa356901a41c32f7adbc6783fe1212a9266df9e7ab7863cf1d93dd",
			sourceLabel: "docs/design/persona-archetypes/bootstrap-commander.md"
		},
		transcript: [],
		currentQuestion: null,
		answerCount: 0,
		questionCount: LOCAL_COMMANDER_FIRST_CHAT_QUESTIONS.length,
		canConclude: false,
		startedAt: null,
		completedAt: null
	};
}
