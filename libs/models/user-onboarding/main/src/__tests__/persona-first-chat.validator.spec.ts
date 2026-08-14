import { describe, expect, it } from "vitest";

import { PersonaFirstChatArchetypes, PersonaFirstChatColours, PersonaFirstChatTranscriptKinds, PersonaFirstChatTranscriptRoles, UserOnboardingRouteStates, type PersonaFirstChatSnapshot } from "../persona-first-chat.types";
import { ___ParsePersonaFirstChatSnapshot } from "../persona-first-chat.validator";

/** Build one valid started projection for pure model validation tests. */
function _Snapshot(overrides: Partial<PersonaFirstChatSnapshot> = {}): PersonaFirstChatSnapshot
{
	return {
		workflowVersion: 1,
		state: UserOnboardingRouteStates.BootstrapChatInProgress,
		conversationId: "conversation-1",
		persona: { revisionId: "persona-1", displayName: "Nova", archetype: PersonaFirstChatArchetypes.Commander, primaryColour: PersonaFirstChatColours.Red },
		contentRevision: { id: "content-1", digest: `sha256:${"a".repeat(64)}`, sourceLabel: "Commander bootstrap" },
		transcript: [
			{ ordinal: 1, role: PersonaFirstChatTranscriptRoles.Assistant, kind: PersonaFirstChatTranscriptKinds.Opening, text: "Welcome.", questionOrdinal: null },
			{ ordinal: 2, role: PersonaFirstChatTranscriptRoles.Assistant, kind: PersonaFirstChatTranscriptKinds.Question, text: "Question one", questionOrdinal: 1 }
		],
		currentQuestion: { ordinal: 1, text: "Question one" },
		answerCount: 0,
		questionCount: 3,
		canConclude: false,
		startedAt: "2026-08-08T10:00:00.000Z",
		completedAt: null,
		...overrides
	};
}

describe("first-chat projection validation", function _ProjectionValidation()
{
	it("accepts the resumable projection and strips unknown extensions", function _ValidProjection()
	{
		const parsed = ___ParsePersonaFirstChatSnapshot({ ..._Snapshot(), ignored: "future-field" });
		expect(parsed.state).toBe(UserOnboardingRouteStates.BootstrapChatInProgress);
		expect(parsed).not.toHaveProperty("ignored");
	});

	it("accepts migrated completion without inventing chat evidence", function _MigratedCompletion()
	{
		const parsed = ___ParsePersonaFirstChatSnapshot(_Snapshot({ state: UserOnboardingRouteStates.Completed, conversationId: null, persona: null, contentRevision: null, transcript: [], currentQuestion: null, questionCount: 0, startedAt: null, completedAt: "2026-08-08T11:00:00.000Z" }));
		expect(parsed.conversationId).toBeNull();
	});

	it("rejects ordering and next-question disagreement", function _Ordering()
	{
		expect(function _Reordered() { ___ParsePersonaFirstChatSnapshot(_Snapshot({ transcript: [{ ..._Snapshot().transcript[0]!, ordinal: 2 }] })); }).toThrow("invalid first-chat projection");
		expect(function _WrongQuestion() { ___ParsePersonaFirstChatSnapshot(_Snapshot({ answerCount: 1, currentQuestion: { ordinal: 3, text: "Wrong" } })); }).toThrow("invalid first-chat projection");
	});

	it("rejects missing provenance and impossible completion", function _CompletionEvidence()
	{
		expect(function _MissingPersona() { ___ParsePersonaFirstChatSnapshot(_Snapshot({ persona: null })); }).toThrow("invalid first-chat projection");
		expect(function _IncompleteCompletion() { ___ParsePersonaFirstChatSnapshot(_Snapshot({ state: UserOnboardingRouteStates.Completed, completedAt: "2026-08-08T11:00:00.000Z" })); }).toThrow("invalid first-chat projection");
	});

	it("rejects transcript roles, kinds, and question coordinates that disagree", function _TranscriptSemantics()
	{
		const invalidOpening = { ..._Snapshot().transcript[0]!, role: PersonaFirstChatTranscriptRoles.User, kind: PersonaFirstChatTranscriptKinds.Answer, questionOrdinal: 1 };
		expect(function _InvalidOpening() { ___ParsePersonaFirstChatSnapshot(_Snapshot({ transcript: [invalidOpening, _Snapshot().transcript[1]!] })); }).toThrow("invalid first-chat projection");
	});

	it("rejects invalid dates and field bounds", function _Bounds()
	{
		expect(function _BadDate() { ___ParsePersonaFirstChatSnapshot(_Snapshot({ startedAt: "not-a-date" })); }).toThrow("invalid first-chat projection");
		expect(function _LongText() { ___ParsePersonaFirstChatSnapshot(_Snapshot({ transcript: [{ ..._Snapshot().transcript[0]!, text: "x".repeat(20_001) }, _Snapshot().transcript[1]!] })); }).toThrow("invalid first-chat projection");
	});
});
