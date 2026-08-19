import { Prisma, type PrismaClient, UserOnboardingBootstrapArchetype, UserOnboardingCompletionProvenance, UserOnboardingState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaUserOnboardingRepository } from "../prisma-user-onboarding-repository";
import { UserOnboardingAnswerStatuses, UserOnboardingBootstrapArchetypes, UserOnboardingCompletionProvenances, UserOnboardingPersonaColours, UserOnboardingStates } from "../user-onboarding.enums";
import type { AppendUserOnboardingAnswerCommand, StartUserOnboardingChatCommand } from "../user-onboarding-chat.types";

/** Stable persisted row returned by the mocked Prisma delegate. */
const _ROW: Prisma.UserOnboardingGetPayload<Record<string, never>> = {
	id: "onboarding-a",
	siloId: "silo-a",
	userId: "subject-a",
	workflowVersion: 3,
	state: UserOnboardingState.Completed,
	personaInterviewId: "interview-a",
	personaRevisionId: "revision-a",
	bootstrapConversationId: "conversation-a",
	bootstrapContentRevisionId: "bootstrap-v1",
	bootstrapContentDigest: "sha256:bootstrap",
	completionProvenance: UserOnboardingCompletionProvenance.BootstrapConcluded,
	completionMigrationRevision: null,
	completionMigrationBatch: null,
	startedAt: new Date("2026-08-08T10:00:00.000Z"),
	surveyStartedAt: new Date("2026-08-08T10:01:00.000Z"),
	completedAt: new Date("2026-08-08T10:20:00.000Z"),
	updatedAt: new Date("2026-08-08T10:20:00.000Z"),
};

/** Build a repository over one explicitly mocked UserOnboarding delegate. */
function _Repository(delegate: Record<string, unknown>): PrismaUserOnboardingRepository
{
	return new PrismaUserOnboardingRepository({ userOnboarding: delegate } as unknown as Prisma.TransactionClient & Pick<PrismaClient, "$transaction">);
}

/** Build a repository over the exact chat delegates supplied by one adapter test. */
function _ChatRepository(delegates: Record<string, unknown>): PrismaUserOnboardingRepository
{
	return new PrismaUserOnboardingRepository({ userOnboarding: {}, userOnboardingBootstrapAnswer: {}, userOnboardingBootstrapConversation: {}, ...delegates } as unknown as Prisma.TransactionClient & Pick<PrismaClient, "$transaction">);
}

/** Build one exact bootstrap start command with immutable owner, persona, and content pins. */
function _StartCommand(): StartUserOnboardingChatCommand
{
	return {
		conversationId: "conversation-a",
		onboarding: { id: "onboarding-a", siloId: "silo-a", subjectId: "subject-a", workflowVersion: 1, state: UserOnboardingStates.BootstrapChatPending, personaInterviewId: "interview-a", personaRevisionId: "revision-a", bootstrapConversationId: null, bootstrapContentRevisionId: null, bootstrapContentDigest: null, completionProvenance: null, completionMigrationRevision: null, completionMigrationBatch: null, startedAt: new Date("2026-08-08T10:00:00.000Z"), surveyStartedAt: new Date("2026-08-08T10:01:00.000Z"), completedAt: null, updatedAt: new Date("2026-08-08T10:02:00.000Z") },
		persona: { personaRevisionId: "revision-a", displayName: "The Commander", archetype: UserOnboardingBootstrapArchetypes.Commander, primaryColour: UserOnboardingPersonaColours.Red },
		content: { id: "bootstrap-commander-v1", revision: 1, archetype: UserOnboardingBootstrapArchetypes.Commander, primaryColour: UserOnboardingPersonaColours.Red, sourceLabel: "docs/design/persona-archetypes/bootstrap-commander.md", digest: `sha256:${"a".repeat(64)}`, opening: "Opening", questions: [1, 2, 3].map(function _Question(ordinal) { return { ordinal, prompt: `Question ${ordinal}` }; }) },
	};
}

/** Build one exact answer persistence command. */
function _AppendCommand(overrides: Partial<AppendUserOnboardingAnswerCommand> = {}): AppendUserOnboardingAnswerCommand
{
	return { answerId: "answer-a", owner: { siloId: "silo-a", subjectId: "subject-a" }, conversationId: "conversation-a", questionOrdinal: 1, text: "Answer", idempotencyKey: "key-a", ...overrides };
}

describe("PrismaUserOnboardingRepository", function _PrismaUserOnboardingRepositorySuite()
{
	it("keys ensure by the session-derived silo and subject while pinning only new workflows", async function _EnsuresOwnerWorkflow()
	{
		const upsert = vi.fn().mockResolvedValue({ ..._ROW, state: UserOnboardingState.SurveyPending, completionProvenance: null });
		const repository = _Repository({ upsert });

		const result = await repository.ensure({ siloId: "silo-a", subjectId: "subject-a" }, 3);

		expect(upsert).toHaveBeenCalledWith({
			where: { siloId_userId: { siloId: "silo-a", userId: "subject-a" } },
			create: { id: expect.stringMatching(/^[0-9a-f-]{36}$/u), siloId: "silo-a", userId: "subject-a", workflowVersion: 3 },
			update: {},
		});
		expect(result).toMatchObject({ subjectId: "subject-a", workflowVersion: 3, state: UserOnboardingStates.SurveyPending });
	});

	it("projects all exact bootstrap and completion references on read", async function _ProjectsExactReferences()
	{
		const findUnique = vi.fn().mockResolvedValue(_ROW);
		const result = await _Repository({ findUnique }).read({ siloId: "silo-a", subjectId: "subject-a" });

		expect(result).toMatchObject({
			state: UserOnboardingStates.Completed,
			personaInterviewId: "interview-a",
			personaRevisionId: "revision-a",
			bootstrapConversationId: "conversation-a",
			bootstrapContentRevisionId: "bootstrap-v1",
			bootstrapContentDigest: "sha256:bootstrap",
			completionProvenance: UserOnboardingCompletionProvenances.BootstrapConcluded,
		});
	});

	it("never overwrites the first survey start time when resuming the pinned interview", async function _PreservesSurveyStartTime()
	{
		const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 });
		const advanced = await _Repository({ updateMany }).markSurveyInProgress({ siloId: "silo-a", subjectId: "subject-a" }, "interview-a");

		expect(advanced).toBe(true);
		expect(updateMany).toHaveBeenCalledTimes(1);
		expect(updateMany).toHaveBeenCalledWith({
			where: { siloId: "silo-a", userId: "subject-a", state: UserOnboardingState.SurveyInProgress, personaInterviewId: "interview-a" },
			data: { state: UserOnboardingState.SurveyInProgress },
		});
	});

	it("CAS-replaces only the expected interview while every later evidence slot remains empty", async function _ReplacesInitialInterview()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const replaced = await _Repository({ updateMany }).replaceSurveyInterview({ siloId: "silo-a", subjectId: "subject-a" }, "interview-a", "interview-b");

		expect(replaced).toBe(true);
		expect(updateMany).toHaveBeenCalledWith({
			where: {
				siloId: "silo-a",
				userId: "subject-a",
				state: UserOnboardingState.SurveyInProgress,
				personaInterviewId: "interview-a",
				personaRevisionId: null,
				bootstrapConversationId: null,
				bootstrapContentRevisionId: null,
				bootstrapContentDigest: null,
				completionProvenance: null,
				completionMigrationRevision: null,
				completionMigrationBatch: null,
				completedAt: null,
			},
			data: { personaInterviewId: "interview-b" },
		});
	});

	it("admits approval only for the exact owner, state, interview, and empty revision slot", async function _PinsExactApprovalEvidence()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const advanced = await _Repository({ updateMany }).markPersonaApproved(
			{ siloId: "silo-a", subjectId: "subject-a" },
			{ interviewId: "interview-a", personaRevisionId: "revision-a" },
		);

		expect(advanced).toBe(true);
		expect(updateMany).toHaveBeenCalledWith({
			where: { siloId: "silo-a", userId: "subject-a", state: UserOnboardingState.SurveyInProgress, personaInterviewId: "interview-a", personaRevisionId: null },
			data: { state: UserOnboardingState.BootstrapChatPending, personaRevisionId: "revision-a" },
		});
	});

	it("starts by creating the exact conversation before pinning it on the parent", async function _StartsConversation()
	{
		const calls: string[] = [];
		const create = vi.fn(async function _Create()
		{
			calls.push("conversation.create");
		});
		const update = vi.fn().mockResolvedValue({});
		const $transaction = vi.fn(async function _Transaction(work: (transaction: Prisma.TransactionClient) => Promise<void>, options: { readonly isolationLevel: Prisma.TransactionIsolationLevel }): Promise<void>
		{
			expect(options.isolationLevel).toBe(Prisma.TransactionIsolationLevel.Serializable);
			await work({
				userOnboarding: {
					update: async function _Update(input: unknown)
					{
						calls.push("userOnboarding.update");
						return update(input);
					},
				},
				userOnboardingBootstrapConversation: { create },
			} as unknown as Prisma.TransactionClient);
		});
		const started = await _ChatRepository({ $transaction }).startConversation(_StartCommand());

		expect(started).toBe(true);
		expect(calls).toEqual(["conversation.create", "userOnboarding.update"]);
		expect(create).toHaveBeenCalledWith({ data: { id: "conversation-a", onboardingId: "onboarding-a", siloId: "silo-a", userId: "subject-a", personaRevisionId: "revision-a", personaDisplayName: "The Commander", personaArchetype: UserOnboardingBootstrapArchetype.Commander, contentRevisionId: "bootstrap-commander-v1", contentDigest: `sha256:${"a".repeat(64)}` } });
		expect(update).toHaveBeenCalledWith({
			where: { siloId_userId: { siloId: "silo-a", userId: "subject-a" }, state: UserOnboardingState.BootstrapChatPending, id: "onboarding-a", personaRevisionId: "revision-a", bootstrapConversationId: null },
			data: {
				state: UserOnboardingState.BootstrapChatInProgress,
				bootstrapConversationId: "conversation-a",
				bootstrapContentRevisionId: "bootstrap-commander-v1",
				bootstrapContentDigest: `sha256:${"a".repeat(64)}`,
			},
		});
	});

	it("returns a start conflict only for a failed compare-and-set update", async function _RejectsStartConflict()
	{
		const conflict = new Prisma.PrismaClientKnownRequestError("stale onboarding", { code: "P2025", clientVersion: "test" });
		const $transaction = vi.fn(async function _Transaction(): Promise<void> { throw conflict; });

		await expect(_ChatRepository({ $transaction }).startConversation(_StartCommand())).resolves.toBe(false);
	});

	it("returns a start conflict when a concurrent winner advances the parent before child insert", async function _RejectsConcurrentStartTrigger()
	{
		const conflict = new Prisma.PrismaClientUnknownRequestError("bootstrap conversation must bind the exact pending onboarding owner and persona", { clientVersion: "test" });
		const $transaction = vi.fn(async function _Transaction(): Promise<void> { throw conflict; });

		await expect(_ChatRepository({ $transaction }).startConversation(_StartCommand())).resolves.toBe(false);
	});

	it("appends only the exact next question through the answer delegate", async function _AppendsExactQuestion()
	{
		const answerFind = vi.fn().mockResolvedValue(null);
		const create = vi.fn().mockResolvedValue({});
		const conversationFind = vi.fn().mockResolvedValue({ id: "conversation-a", answers: [] });
		const result = await _ChatRepository({ userOnboardingBootstrapAnswer: { findFirst: answerFind, create }, userOnboardingBootstrapConversation: { findFirst: conversationFind } }).appendAnswer(_AppendCommand());

		expect(result.status).toBe(UserOnboardingAnswerStatuses.Recorded);
		expect(conversationFind).toHaveBeenCalledWith({ where: { id: "conversation-a", siloId: "silo-a", userId: "subject-a", onboarding: { state: UserOnboardingState.BootstrapChatInProgress, bootstrapConversationId: "conversation-a" } }, select: { id: true, answers: { select: { ordinal: true }, orderBy: { ordinal: "asc" } } } });
		expect(create).toHaveBeenCalledWith({ data: { id: "answer-a", conversationId: "conversation-a", ordinal: 1, questionOrdinal: 1, text: "Answer", idempotencyKey: "key-a" } });
	});

	it("resumes only the same key, text, and question without reading mutable conversation state", async function _ResumesExactAnswer()
	{
		const conversationFind = vi.fn();
		const create = vi.fn();
		const exact = _ChatRepository({ userOnboardingBootstrapAnswer: { findFirst: vi.fn().mockResolvedValue({ text: "Answer", questionOrdinal: 1 }), create }, userOnboardingBootstrapConversation: { findFirst: conversationFind } });
		const mismatched = _ChatRepository({ userOnboardingBootstrapAnswer: { findFirst: vi.fn().mockResolvedValue({ text: "Answer", questionOrdinal: 1 }), create }, userOnboardingBootstrapConversation: { findFirst: conversationFind } });

		await expect(exact.appendAnswer(_AppendCommand())).resolves.toEqual({ status: UserOnboardingAnswerStatuses.Resumed });
		await expect(mismatched.appendAnswer(_AppendCommand({ questionOrdinal: 2 }))).resolves.toEqual({ status: UserOnboardingAnswerStatuses.IdempotencyConflict });
		expect(conversationFind).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
	});

	it("rejects a stale expected question before creating an answer", async function _RejectsStaleQuestion()
	{
		const create = vi.fn();
		const repository = _ChatRepository({ userOnboardingBootstrapAnswer: { findFirst: vi.fn().mockResolvedValue(null), create }, userOnboardingBootstrapConversation: { findFirst: vi.fn().mockResolvedValue({ id: "conversation-a", answers: [{ ordinal: 1 }] }) } });

		await expect(repository.appendAnswer(_AppendCommand({ questionOrdinal: 1 }))).resolves.toEqual({ status: UserOnboardingAnswerStatuses.StateConflict });
		expect(create).not.toHaveBeenCalled();
	});

	it("recovers an exact retry winner after a concurrent answer insert", async function _RecoversConcurrentRetry()
	{
		const conflict = new Prisma.PrismaClientKnownRequestError("duplicate answer", { code: "P2002", clientVersion: "test" });
		const answerFind = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ text: "Answer", questionOrdinal: 1 });
		const repository = _ChatRepository({ userOnboardingBootstrapAnswer: { findFirst: answerFind, create: vi.fn().mockRejectedValue(conflict) }, userOnboardingBootstrapConversation: { findFirst: vi.fn().mockResolvedValue({ id: "conversation-a", answers: [] }) } });

		await expect(repository.appendAnswer(_AppendCommand())).resolves.toEqual({ status: UserOnboardingAnswerStatuses.Resumed });
	});

});
