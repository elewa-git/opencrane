import { describe, expect, it } from "vitest";

import { PersonaArchetypeTones } from "@opencrane/elements/ui";
import { PersonaFirstChatArchetypes, PersonaFirstChatColours, PersonaFirstChatTranscriptKinds, PersonaFirstChatTranscriptRoles, UserOnboardingRouteStates, type PersonaFirstChatSnapshot } from "@opencrane/state/onboarding/projection";

import { PersonaFirstChatMessageRoles } from "../persona-first-chat.types";
import { _PersonaFirstChatView } from "../persona-first-chat.view";

/** Build one complete authoritative projection for pure view mapping tests. */
function _Snapshot(overrides: Partial<PersonaFirstChatSnapshot> = {}): PersonaFirstChatSnapshot
{
	return {
		workflowVersion: 1,
		state: UserOnboardingRouteStates.BootstrapChatInProgress,
		conversationId: "conversation-1",
		persona: { revisionId: "persona-revision-1", displayName: "The Commander", archetype: PersonaFirstChatArchetypes.Commander, primaryColour: PersonaFirstChatColours.Red },
		contentRevision: { id: "commander-v1", digest: `sha256:${"a".repeat(64)}`, sourceLabel: "The Commander bootstrap" },
		transcript: [
			{ ordinal: 1, role: PersonaFirstChatTranscriptRoles.Assistant, kind: PersonaFirstChatTranscriptKinds.Opening, text: "Welcome.", questionOrdinal: null },
			{ ordinal: 2, role: PersonaFirstChatTranscriptRoles.User, kind: PersonaFirstChatTranscriptKinds.Answer, text: "Ship safely.", questionOrdinal: 1 }
		],
		currentQuestion: { ordinal: 2, text: "What wastes time?" },
		answerCount: 1,
		questionCount: 3,
		canConclude: false,
		startedAt: "2026-08-08T10:00:00.000Z",
		completedAt: null,
		...overrides
	};
}

describe("persona first-chat view mapping", function _PersonaFirstChatViewSuite()
{
	it("maps identity, provenance, transcript, and current question without changing authority order", function _CompleteView()
	{
		const view = _PersonaFirstChatView(_Snapshot());

		expect(view).toEqual({
			identity: { name: "The Commander", initials: "TC", archetype: PersonaArchetypeTones.Commander },
			provenance: { personaRevision: "persona-revision-1", scriptLabel: "The Commander bootstrap", scriptRevision: "commander-v1" },
			transcript: [
				{ id: "conversation-1-1", role: PersonaFirstChatMessageRoles.Agent, body: "Welcome." },
				{ id: "conversation-1-2", role: PersonaFirstChatMessageRoles.Owner, body: "Ship safely." }
			],
			currentQuestion: { id: "question-2", ordinal: 2, prompt: "What wastes time?" }
		});
	});

	it("returns no view without exact persona and source evidence", function _IncompleteEvidence()
	{
		expect(_PersonaFirstChatView(_Snapshot({ persona: null }))).toBeNull();
		expect(_PersonaFirstChatView(_Snapshot({ contentRevision: null }))).toBeNull();
	});

	it("rejects a question outside the reviewed three-question contract", function _InvalidQuestion()
	{
		expect(function _MapInvalidQuestion() { _PersonaFirstChatView(_Snapshot({ currentQuestion: { ordinal: 4, text: "Unexpected" } })); }).toThrow("invalid first-chat question ordinal");
	});
});
