import { UserOnboardingRouteStates, type PersonaFirstChatSnapshot } from "@opencrane/models/user-onboarding";

import type { LocalDevelopmentArchetypeFixture } from "./local-development-archetype.types";

/**
 * Build the pending first-chat projection installed after local persona approval.
 *
 * Identity, source label, digest, opening, and prompts mirror the reviewed bootstrap source for the
 * selected archetype used by live onboarding.
 */
export function __CreateLocalPendingFirstChat(fixture: LocalDevelopmentArchetypeFixture): PersonaFirstChatSnapshot
{
	return {
		workflowVersion: 1,
		state: UserOnboardingRouteStates.BootstrapChatPending,
		conversationId: null,
		persona: {
			revisionId: "persona-revision-local-1",
			displayName: fixture.displayName,
			archetype: fixture.archetype,
			primaryColour: fixture.firstChatColour
		},
		contentRevision: {
			id: fixture.firstChat.id,
			digest: fixture.firstChat.digest,
			sourceLabel: fixture.firstChat.sourceLabel
		},
		transcript: [],
		currentQuestion: null,
		answerCount: 0,
		questionCount: fixture.firstChat.questions.length,
		canConclude: false,
		startedAt: null,
		completedAt: null
	};
}
