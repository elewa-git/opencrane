import { describe, expect, it } from "vitest";

import { __UserOnboardingChatAuthority, UserOnboardingChatError } from "../user-onboarding-chat-authority";
import { UserOnboardingAnswerStatuses, UserOnboardingBootstrapArchetypes, UserOnboardingChatFailureReasons, UserOnboardingChatMessageKinds, UserOnboardingPersonaColours, UserOnboardingStates } from "../user-onboarding.enums";
import { UserOnboardingReadinessStatuses, type UserOnboardingCompletionUnitOfWork } from "../user-onboarding-completion.types";
import type { AppendUserOnboardingAnswerCommand, StartUserOnboardingChatCommand, UserOnboardingAnswerPersistenceResult, UserOnboardingBootstrapContentRevision, UserOnboardingBootstrapConversation, UserOnboardingChatRepository } from "../user-onboarding-chat.types";
import type { ApprovedPersonaEvidence, UserOnboardingOwner, UserOnboardingPersonaEvidencePort, UserOnboardingRecord } from "../user-onboarding.types";
import type { __UserOnboardingAuthority } from "../user-onboarding-authority";

/** Stable owner derived from the test session. */
const _OWNER: UserOnboardingOwner = { siloId: "silo-a", subjectId: "subject-a" };

/** Exact three-question Commander content fixture. */
const _CONTENT: UserOnboardingBootstrapContentRevision = {
	id: "bootstrap-commander-v1",
	revision: 1,
	archetype: UserOnboardingBootstrapArchetypes.Commander,
	primaryColour: UserOnboardingPersonaColours.Red,
	sourceLabel: "docs/design/persona-archetypes/bootstrap-commander.md",
	digest: `sha256:${"a".repeat(64)}`,
	opening: "Opening",
	questions: [1, 2, 3].map(function _Question(ordinal) { return { ordinal, prompt: `Question ${ordinal}` }; }),
};

/** In-memory append-only chat repository preserving the production retry rules. */
class _FakeChatRepository implements UserOnboardingChatRepository
{
	/** Shared durable workflow mutated by compare-and-set operations. */
	private readonly workflow: { value: UserOnboardingRecord };
	/** Current durable conversation. */
	private conversation: UserOnboardingBootstrapConversation | null = null;

	/** Bind the fake to one shared workflow reference. */
	constructor(workflow: { value: UserOnboardingRecord }) { this.workflow = workflow; }

	/** Return the reviewed Commander script only for its approved colour. */
	async readContentForColour(primaryColour: UserOnboardingPersonaColours): Promise<UserOnboardingBootstrapContentRevision | null> { return primaryColour === UserOnboardingPersonaColours.Red ? _CONTENT : null; }

	/** Return the owner conversation only to its exact owner. */
	async readConversation(owner: UserOnboardingOwner): Promise<UserOnboardingBootstrapConversation | null> { return owner.siloId === _OWNER.siloId && owner.subjectId === _OWNER.subjectId ? this.conversation : null; }

	/** Create and pin the only conversation from bootstrap-chat-pending. */
	async startConversation(command: StartUserOnboardingChatCommand): Promise<boolean>
	{
		if (this.conversation !== null || this.workflow.value.state !== UserOnboardingStates.BootstrapChatPending) return false;
		this.conversation = { id: command.conversationId, onboardingId: command.onboarding.id, siloId: command.onboarding.siloId, subjectId: command.onboarding.subjectId, personaRevisionId: command.persona.personaRevisionId, personaDisplayName: command.persona.displayName, personaArchetype: command.persona.archetype, content: command.content, answers: [], startedAt: new Date("2026-08-08T10:10:00.000Z") };
		this.workflow.value = { ...this.workflow.value, state: UserOnboardingStates.BootstrapChatInProgress, bootstrapConversationId: command.conversationId, bootstrapContentRevisionId: command.content.id, bootstrapContentDigest: command.content.digest };
		return true;
	}

	/** Resume an identical key before enforcing the three-answer bound. */
	async appendAnswer(command: AppendUserOnboardingAnswerCommand): Promise<UserOnboardingAnswerPersistenceResult>
	{
		if (this.conversation === null) return { status: UserOnboardingAnswerStatuses.StateConflict };
		const existing = this.conversation.answers.find(answer => answer.idempotencyKey === command.idempotencyKey);
		if (existing !== undefined) return { status: existing.text === command.text && existing.questionOrdinal === command.questionOrdinal ? UserOnboardingAnswerStatuses.Resumed : UserOnboardingAnswerStatuses.IdempotencyConflict };
		if (command.questionOrdinal !== this.conversation.answers.length + 1 || command.questionOrdinal > 3) return { status: UserOnboardingAnswerStatuses.StateConflict };
		this.conversation = { ...this.conversation, answers: [...this.conversation.answers, { id: command.answerId, ordinal: command.questionOrdinal, questionOrdinal: command.questionOrdinal, text: command.text, idempotencyKey: command.idempotencyKey, answeredAt: new Date() }] };
		return { status: UserOnboardingAnswerStatuses.Recorded };
	}

}

/** Persona evidence port exposing only one approved active Commander revision. */
const _PERSONA: UserOnboardingPersonaEvidencePort = {
	async ownsInterview(): Promise<boolean> { return true; },
	async readApprovedPersona(_owner: UserOnboardingOwner, evidence: ApprovedPersonaEvidence): Promise<ApprovedPersonaEvidence> { return evidence; },
	async readLatestApprovedPersona(): Promise<ApprovedPersonaEvidence> { return { interviewId: "interview-a", personaRevisionId: "revision-a" }; },
	async readApprovedBootstrapEvidence(_owner: UserOnboardingOwner, personaRevisionId: string) { return personaRevisionId === "revision-a" ? { personaRevisionId, displayName: "The Commander", archetype: UserOnboardingBootstrapArchetypes.Commander, primaryColour: UserOnboardingPersonaColours.Red } : null; },
};

/** Build one bootstrap-pending workflow. */
function _Workflow(): UserOnboardingRecord
{
	const startedAt = new Date("2026-08-08T10:00:00.000Z");
	return { id: "onboarding-a", siloId: _OWNER.siloId, subjectId: _OWNER.subjectId, workflowVersion: 1, state: UserOnboardingStates.BootstrapChatPending, personaInterviewId: "interview-a", personaRevisionId: "revision-a", bootstrapConversationId: null, bootstrapContentRevisionId: null, bootstrapContentDigest: null, completionProvenance: null, completionMigrationRevision: null, completionMigrationBatch: null, startedAt, surveyStartedAt: startedAt, completedAt: null, updatedAt: startedAt };
}

/** Build the chat authority over one shared mutable workflow. */
function _Authority()
{
	const workflow = { value: _Workflow() };
	const onboarding = { readOrCreate: async function _ReadOrCreate() { return workflow.value; } } as unknown as __UserOnboardingAuthority;
	const completion: UserOnboardingCompletionUnitOfWork = {
		async complete()
		{
			workflow.value = { ...workflow.value, state: UserOnboardingStates.Completed, completionProvenance: "bootstrap_concluded" as never, completedAt: new Date() };
			return { status: UserOnboardingReadinessStatuses.Ready, agentServiceId: "agent-a" };
		},
		async ensureReady() { return { status: UserOnboardingReadinessStatuses.Ready, agentServiceId: "agent-a" }; },
	};
	return { authority: new __UserOnboardingChatAuthority(onboarding, new _FakeChatRepository(workflow), _PERSONA, completion), workflow };
}

/** Build one owner answer fenced to the server-issued conversation question. */
function _Answer(expectedConversationId: string, expectedQuestionOrdinal: number, text: string, idempotencyKey: string)
{
	return { expectedConversationId, expectedQuestionOrdinal, text, idempotencyKey };
}

describe("__UserOnboardingChatAuthority", function _UserOnboardingChatAuthoritySuite()
{
	it("runs one deterministic three-question exchange and concludes server-side", async function _RunsExchange()
	{
		const { authority } = _Authority();
		const started = await authority.start(_OWNER);
		expect(started).toMatchObject({ state: UserOnboardingStates.BootstrapChatInProgress, answerCount: 0, questionCount: 3, currentQuestion: { ordinal: 1, text: "Question 1" } });
		const conversationId = started.conversationId ?? "";

		await authority.answer(_OWNER, _Answer(conversationId, 1, " Answer one ", "key-1"));
		await authority.answer(_OWNER, _Answer(conversationId, 2, "Answer two", "key-2"));
		const third = await authority.answer(_OWNER, _Answer(conversationId, 3, "Answer three", "key-3"));
		expect(third.chat).toMatchObject({ answerCount: 3, currentQuestion: null, canConclude: true });

		const completed = await authority.conclude(_OWNER);
		expect(completed.state).toBe(UserOnboardingStates.Completed);
		expect(completed.transcript.at(-1)).toMatchObject({ kind: UserOnboardingChatMessageKinds.Answer, text: "Answer three" });
	});

	it("resumes an identical third-answer retry while rejecting conflicting or new fourth keys", async function _RetriesThirdAnswer()
	{
		const { authority } = _Authority();
		const started = await authority.start(_OWNER);
		const conversationId = started.conversationId ?? "";
		await authority.answer(_OWNER, _Answer(conversationId, 1, "One", "key-1"));
		await authority.answer(_OWNER, _Answer(conversationId, 2, "Two", "key-2"));
		await authority.answer(_OWNER, _Answer(conversationId, 3, "Three", "key-3"));

		const resumed = await authority.answer(_OWNER, _Answer(conversationId, 3, " Three ", "key-3"));
		const conflicting = await authority.answer(_OWNER, _Answer(conversationId, 3, "Different", "key-3"));
		const fourth = await authority.answer(_OWNER, _Answer(conversationId, 3, "Four", "key-4"));

		expect(resumed.status).toBe(UserOnboardingAnswerStatuses.Resumed);
		expect(conflicting.status).toBe(UserOnboardingAnswerStatuses.IdempotencyConflict);
		expect(fourth.status).toBe(UserOnboardingAnswerStatuses.StateConflict);
		expect(fourth.chat.answerCount).toBe(3);
	});

	it("recovers exact answer identity after another client concludes onboarding", async function _RetriesAfterConclusion()
	{
		const { authority } = _Authority();
		const started = await authority.start(_OWNER);
		const conversationId = started.conversationId ?? "";
		await authority.answer(_OWNER, _Answer(conversationId, 1, "One", "key-1"));
		await authority.answer(_OWNER, _Answer(conversationId, 2, "Two", "key-2"));
		await authority.answer(_OWNER, _Answer(conversationId, 3, "Three", "key-3"));
		await authority.conclude(_OWNER);

		const resumed = await authority.answer(_OWNER, _Answer(conversationId, 3, " Three ", "key-3"));
		const conflicting = await authority.answer(_OWNER, _Answer(conversationId, 3, "Different", "key-3"));
		const newKey = await authority.answer(_OWNER, _Answer(conversationId, 3, "Three", "key-4"));

		expect(resumed).toMatchObject({ status: UserOnboardingAnswerStatuses.Resumed, chat: { state: UserOnboardingStates.Completed, answerCount: 3 } });
		expect(conflicting).toMatchObject({ status: UserOnboardingAnswerStatuses.IdempotencyConflict, chat: { state: UserOnboardingStates.Completed, answerCount: 3 } });
		expect(newKey).toMatchObject({ status: UserOnboardingAnswerStatuses.StateConflict, chat: { state: UserOnboardingStates.Completed, answerCount: 3 } });
	});

	it("refuses conclusion until exactly three durable answers exist", async function _RejectsEarlyConclusion()
	{
		const { authority } = _Authority();
		const started = await authority.start(_OWNER);
		await authority.answer(_OWNER, _Answer(started.conversationId ?? "", 1, "One", "key-1"));

		await expect(authority.conclude(_OWNER)).rejects.toMatchObject({ reason: UserOnboardingChatFailureReasons.NotConcludable } satisfies Partial<UserOnboardingChatError>);
	});

	it("rejects delayed answers for a stale conversation or already-answered question", async function _RejectsStaleCoordinates()
	{
		const { authority } = _Authority();
		const started = await authority.start(_OWNER);
		const conversationId = started.conversationId ?? "";
		await authority.answer(_OWNER, _Answer(conversationId, 1, "Device A answer", "key-a"));

		const delayed = await authority.answer(_OWNER, _Answer(conversationId, 1, "Device B delayed answer", "key-b"));
		const wrongConversation = await authority.answer(_OWNER, _Answer("conversation-stale", 2, "Wrong conversation", "key-c"));

		expect(delayed).toMatchObject({ status: UserOnboardingAnswerStatuses.StateConflict, chat: { answerCount: 1, currentQuestion: { ordinal: 2 } } });
		expect(wrongConversation).toMatchObject({ status: UserOnboardingAnswerStatuses.StateConflict, chat: { conversationId, answerCount: 1 } });
	});
});
