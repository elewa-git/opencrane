import { randomUUID } from "node:crypto";

import { PersonaColour, Prisma, type PrismaClient, UserOnboardingBootstrapArchetype, UserOnboardingCompletionProvenance, UserOnboardingState } from "@prisma/client";

import { UserOnboardingAnswerStatuses, UserOnboardingBootstrapArchetypes, UserOnboardingCompletionProvenances, UserOnboardingPersonaColours, UserOnboardingStates } from "./user-onboarding.enums";
import type { AppendUserOnboardingAnswerCommand, StartUserOnboardingChatCommand, UserOnboardingAnswerPersistenceResult, UserOnboardingBootstrapContentRevision, UserOnboardingBootstrapConversation, UserOnboardingChatRepository } from "./user-onboarding-chat.types";
import type { ApprovedPersonaEvidence, UserOnboardingOwner, UserOnboardingRecord, UserOnboardingRepository } from "./user-onboarding.types";

/** Trigger text emitted when a concurrent starter loses after another transaction advanced the parent. */
const _BOOTSTRAP_CONVERSATION_PENDING_TRIGGER = "bootstrap conversation must bind the exact pending onboarding owner and persona";

/**
 * Build the one object that satisfies both onboarding persistence ports over Postgres.
 *
 * Returns both {@link UserOnboardingRepository} and {@link UserOnboardingChatRepository} from a
 * single instance so the workflow row and its bootstrap conversation are written through the same
 * client. Exists so the app's composition root never constructs the Prisma class directly.
 *
 * Called by: _CreateUserOnboardingComposition in
 * apps/opencrane/src/app/user-onboarding-composition.ts.
 *
 * @param prisma - Product database client, or a transaction client in tests.
 * @returns One adapter usable as either onboarding port.
 */
export function _CreateUserOnboardingRepository(prisma: PrismaClient): UserOnboardingRepository & UserOnboardingChatRepository
{
	return new PrismaUserOnboardingRepository(prisma);
}

/** Prisma persistence adapter that can mutate only the UserOnboarding authority. */
export class PrismaUserOnboardingRepository implements UserOnboardingRepository, UserOnboardingChatRepository
{
	/** Canonical product database capability used directly or as a transaction opener. */
	private readonly prisma: Prisma.TransactionClient & Pick<PrismaClient, "$transaction">;

	/** Create an onboarding repository at the reviewed persistence boundary. */
	constructor(prisma: Prisma.TransactionClient & Pick<PrismaClient, "$transaction">)
	{
		this.prisma = prisma;
	}

	/** Return the existing pinned workflow or create the current survey-pending version once. */
	async ensure(owner: UserOnboardingOwner, currentWorkflowVersion: number): Promise<UserOnboardingRecord>
	{
		const row = await this.prisma.userOnboarding.upsert({
			where: { siloId_userId: _OwnerKey(owner) },
			create: { id: randomUUID(), siloId: owner.siloId, userId: owner.subjectId, workflowVersion: currentWorkflowVersion },
			update: {},
		});
		return _ProjectUserOnboarding(row);
	}

	/** Read only the workflow selected by the session-derived silo and subject. */
	async read(owner: UserOnboardingOwner): Promise<UserOnboardingRecord | null>
	{
		const row = await this.prisma.userOnboarding.findUnique({ where: { siloId_userId: _OwnerKey(owner) } });
		return row === null ? null : _ProjectUserOnboarding(row);
	}

	/** Pin one owner-verified interview without allowing bootstrap or completed workflows to regress. */
	async markSurveyInProgress(owner: UserOnboardingOwner, interviewId: string): Promise<boolean>
	{
		const resumed = await this.prisma.userOnboarding.updateMany({
			where: {
				siloId: owner.siloId,
				userId: owner.subjectId,
				state: UserOnboardingState.SurveyInProgress,
				personaInterviewId: interviewId,
			},
			data: { state: UserOnboardingState.SurveyInProgress },
		});
		if (resumed.count === 1) return true;
		const started = await this.prisma.userOnboarding.updateMany({
			where: { siloId: owner.siloId, userId: owner.subjectId, state: UserOnboardingState.SurveyPending, personaInterviewId: null },
			data: { state: UserOnboardingState.SurveyInProgress, personaInterviewId: interviewId, surveyStartedAt: new Date() },
		});
		return started.count === 1;
	}

	/** CAS-replace only the expected initial-survey interview while every later evidence slot is empty. */
	async replaceSurveyInterview(owner: UserOnboardingOwner, expectedInterviewId: string, replacementInterviewId: string): Promise<boolean>
	{
		const replaced = await this.prisma.userOnboarding.updateMany({
			where: {
				siloId: owner.siloId,
				userId: owner.subjectId,
				state: UserOnboardingState.SurveyInProgress,
				personaInterviewId: expectedInterviewId,
				personaRevisionId: null,
				bootstrapConversationId: null,
				bootstrapContentRevisionId: null,
				bootstrapContentDigest: null,
				completionProvenance: null,
				completionMigrationRevision: null,
				completionMigrationBatch: null,
				completedAt: null,
			},
			data: { personaInterviewId: replacementInterviewId },
		});
		return replaced.count === 1;
	}

	/** Pin exact approved persona evidence only from the matching in-progress interview. */
	async markPersonaApproved(owner: UserOnboardingOwner, evidence: ApprovedPersonaEvidence): Promise<boolean>
	{
		const updated = await this.prisma.userOnboarding.updateMany({
			where: {
				siloId: owner.siloId,
				userId: owner.subjectId,
				state: UserOnboardingState.SurveyInProgress,
				personaInterviewId: evidence.interviewId,
				personaRevisionId: null,
			},
			data: { state: UserOnboardingState.BootstrapChatPending, personaRevisionId: evidence.personaRevisionId },
		});
		return updated.count === 1;
	}

	/** Select the single reviewed bootstrap revision for the approved persona colour. */
	async readContentForColour(primaryColour: UserOnboardingPersonaColours): Promise<UserOnboardingBootstrapContentRevision | null>
	{
		const content = await this.prisma.userOnboardingBootstrapContentRevision.findFirst({ where: { primaryColour: _PrismaColour(primaryColour) }, orderBy: { revision: "desc" }, include: { questions: { orderBy: { ordinal: "asc" } } } });
		return content === null ? null : _ProjectContent(content);
	}

	/** Read the exact owner-bound bootstrap conversation with immutable content and answers. */
	async readConversation(owner: UserOnboardingOwner): Promise<UserOnboardingBootstrapConversation | null>
	{
		const conversation = await this.prisma.userOnboardingBootstrapConversation.findFirst({ where: { siloId: owner.siloId, userId: owner.subjectId, onboarding: { siloId: owner.siloId, userId: owner.subjectId } }, include: { contentRevision: { include: { questions: { orderBy: { ordinal: "asc" } } } }, answers: { orderBy: { ordinal: "asc" } } } });
		return conversation === null ? null : _ProjectConversation(conversation);
	}

	/** Atomically create and pin the only bootstrap conversation for one onboarding workflow. */
	async startConversation(command: StartUserOnboardingChatCommand): Promise<boolean>
	{
		try
		{
			await this.prisma.$transaction(async function _StartTransaction(transaction: Prisma.TransactionClient)
			{
				// 1. Insert the child evidence while the parent is still pending so its trigger can verify the pending owner and persona.
				await transaction.userOnboardingBootstrapConversation.create({ data: { id: command.conversationId, onboardingId: command.onboarding.id, siloId: command.onboarding.siloId, userId: command.onboarding.subjectId, personaRevisionId: command.persona.personaRevisionId, personaDisplayName: command.persona.displayName, personaArchetype: _PrismaArchetype(command.persona.archetype), contentRevisionId: command.content.id, contentDigest: command.content.digest } });

				// 2. Pin the parent only after the child row exists, matching the lifecycle trigger's exact provenance check.
				await transaction.userOnboarding.update({
					where: { siloId_userId: { siloId: command.onboarding.siloId, userId: command.onboarding.subjectId }, state: UserOnboardingState.BootstrapChatPending, id: command.onboarding.id, personaRevisionId: command.persona.personaRevisionId, bootstrapConversationId: null },
					data: {
						state: UserOnboardingState.BootstrapChatInProgress,
						bootstrapConversationId: command.conversationId,
						bootstrapContentRevisionId: command.content.id,
						bootstrapContentDigest: command.content.digest,
					},
				});
			}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			return true;
		}
		catch (err)
		{
			if (_ExpectedConflict(err)) return false;
			throw err;
		}
	}

	/** Append the next answer, resuming only an identical conversation-local retry. */
	async appendAnswer(command: AppendUserOnboardingAnswerCommand): Promise<UserOnboardingAnswerPersistenceResult>
	{
		// 1. Resolve an existing retry first so the same request never consumes another question.
		const existing = await this.prisma.userOnboardingBootstrapAnswer.findFirst({ where: { conversationId: command.conversationId, idempotencyKey: command.idempotencyKey, conversation: { siloId: command.owner.siloId, userId: command.owner.subjectId } }, select: { text: true, questionOrdinal: true } });
		if (existing !== null) return { status: existing.text === command.text && existing.questionOrdinal === command.questionOrdinal ? UserOnboardingAnswerStatuses.Resumed : UserOnboardingAnswerStatuses.IdempotencyConflict };

		// 2. Create only against the exact active owner conversation and next one-based question.
		const conversation = await this.prisma.userOnboardingBootstrapConversation.findFirst({ where: { id: command.conversationId, siloId: command.owner.siloId, userId: command.owner.subjectId, onboarding: { state: UserOnboardingState.BootstrapChatInProgress, bootstrapConversationId: command.conversationId } }, select: { id: true, answers: { select: { ordinal: true }, orderBy: { ordinal: "asc" } } } });
		if (conversation === null || conversation.answers.length + 1 !== command.questionOrdinal || command.questionOrdinal > 3) return { status: UserOnboardingAnswerStatuses.StateConflict };
		try
		{
			await this.prisma.userOnboardingBootstrapAnswer.create({ data: { id: command.answerId, conversationId: command.conversationId, ordinal: command.questionOrdinal, questionOrdinal: command.questionOrdinal, text: command.text, idempotencyKey: command.idempotencyKey } });
			return { status: UserOnboardingAnswerStatuses.Recorded };
		}
		catch (err)
		{
			if (!_ExpectedConflict(err)) throw err;
			const winner = await this.prisma.userOnboardingBootstrapAnswer.findFirst({ where: { conversationId: command.conversationId, idempotencyKey: command.idempotencyKey }, select: { text: true, questionOrdinal: true } });
			if (winner === null) return { status: UserOnboardingAnswerStatuses.StateConflict };
			return { status: winner.text === command.text && winner.questionOrdinal === command.questionOrdinal ? UserOnboardingAnswerStatuses.Resumed : UserOnboardingAnswerStatuses.IdempotencyConflict };
		}
	}

}

/** Build the exact compound owner key used for every persistence lookup. */
function _OwnerKey(owner: UserOnboardingOwner): { siloId: string; userId: string }
{
	return { siloId: owner.siloId, userId: owner.subjectId };
}

/** Translate Prisma's generated enum into this package's own enum, so a Prisma rename cannot reach the API. */
function _ProjectState(state: UserOnboardingState): UserOnboardingStates
{
	const states: Record<UserOnboardingState, UserOnboardingStates> = {
		[UserOnboardingState.SurveyPending]: UserOnboardingStates.SurveyPending,
		[UserOnboardingState.SurveyInProgress]: UserOnboardingStates.SurveyInProgress,
		[UserOnboardingState.BootstrapChatPending]: UserOnboardingStates.BootstrapChatPending,
		[UserOnboardingState.BootstrapChatInProgress]: UserOnboardingStates.BootstrapChatInProgress,
		[UserOnboardingState.Completed]: UserOnboardingStates.Completed,
	};
	return states[state];
}

/** Translate Prisma's nullable `completionProvenance` column into this package's own enum. */
function _ProjectCompletionProvenance(provenance: UserOnboardingCompletionProvenance | null): UserOnboardingCompletionProvenances | null
{
	if (provenance === null) return null;
	const provenances: Record<UserOnboardingCompletionProvenance, UserOnboardingCompletionProvenances> = {
		[UserOnboardingCompletionProvenance.BootstrapConcluded]: UserOnboardingCompletionProvenances.BootstrapConcluded,
		[UserOnboardingCompletionProvenance.ExistingUserMigration]: UserOnboardingCompletionProvenances.ExistingUserMigration,
	};
	return provenances[provenance];
}

/** Project one persistence row without exposing Prisma-generated models to callers. */
function _ProjectUserOnboarding(row: Prisma.UserOnboardingGetPayload<Record<string, never>>): UserOnboardingRecord
{
	return {
		id: row.id,
		siloId: row.siloId,
		subjectId: row.userId,
		workflowVersion: row.workflowVersion,
		state: _ProjectState(row.state),
		personaInterviewId: row.personaInterviewId,
		personaRevisionId: row.personaRevisionId,
		bootstrapConversationId: row.bootstrapConversationId,
		bootstrapContentRevisionId: row.bootstrapContentRevisionId,
		bootstrapContentDigest: row.bootstrapContentDigest,
		completionProvenance: _ProjectCompletionProvenance(row.completionProvenance),
		completionMigrationRevision: row.completionMigrationRevision,
		completionMigrationBatch: row.completionMigrationBatch,
		startedAt: row.startedAt,
		surveyStartedAt: row.surveyStartedAt,
		completedAt: row.completedAt,
		updatedAt: row.updatedAt,
	};
}

/** Map the public colour enum onto Prisma's generated colour enum. */
function _PrismaColour(colour: UserOnboardingPersonaColours): PersonaColour
{
	const colours: Record<UserOnboardingPersonaColours, PersonaColour> = { [UserOnboardingPersonaColours.Red]: PersonaColour.Red, [UserOnboardingPersonaColours.Yellow]: PersonaColour.Yellow, [UserOnboardingPersonaColours.Green]: PersonaColour.Green, [UserOnboardingPersonaColours.Blue]: PersonaColour.Blue };
	return colours[colour];
}

/** Map the public archetype enum onto Prisma's generated archetype enum. */
function _PrismaArchetype(archetype: UserOnboardingBootstrapArchetypes): UserOnboardingBootstrapArchetype
{
	const archetypes: Record<UserOnboardingBootstrapArchetypes, UserOnboardingBootstrapArchetype> = { [UserOnboardingBootstrapArchetypes.Commander]: UserOnboardingBootstrapArchetype.Commander, [UserOnboardingBootstrapArchetypes.Catalyst]: UserOnboardingBootstrapArchetype.Catalyst, [UserOnboardingBootstrapArchetypes.Anchor]: UserOnboardingBootstrapArchetype.Anchor, [UserOnboardingBootstrapArchetypes.Analyst]: UserOnboardingBootstrapArchetype.Analyst };
	return archetypes[archetype];
}

/** Map Prisma's generated archetype enum onto the public API enum. */
function _ProjectArchetype(archetype: UserOnboardingBootstrapArchetype): UserOnboardingBootstrapArchetypes
{
	const archetypes: Record<UserOnboardingBootstrapArchetype, UserOnboardingBootstrapArchetypes> = { [UserOnboardingBootstrapArchetype.Commander]: UserOnboardingBootstrapArchetypes.Commander, [UserOnboardingBootstrapArchetype.Catalyst]: UserOnboardingBootstrapArchetypes.Catalyst, [UserOnboardingBootstrapArchetype.Anchor]: UserOnboardingBootstrapArchetypes.Anchor, [UserOnboardingBootstrapArchetype.Analyst]: UserOnboardingBootstrapArchetypes.Analyst };
	return archetypes[archetype];
}

/** Project an immutable script revision with its ordered reviewed questions. */
function _ProjectContent(content: Prisma.UserOnboardingBootstrapContentRevisionGetPayload<{ include: { questions: true } }>): UserOnboardingBootstrapContentRevision
{
	return { id: content.id, revision: content.revision, archetype: _ProjectArchetype(content.archetype), primaryColour: _ProjectColour(content.primaryColour), sourceLabel: content.sourceLabel, digest: content.digest, opening: content.opening, questions: content.questions.map(function _Question(question) { return { ordinal: question.ordinal, prompt: question.prompt }; }) };
}

/** Map Prisma's generated colour enum onto the public API enum. */
function _ProjectColour(colour: PersonaColour): UserOnboardingPersonaColours
{
	const colours: Record<PersonaColour, UserOnboardingPersonaColours> = { [PersonaColour.Red]: UserOnboardingPersonaColours.Red, [PersonaColour.Yellow]: UserOnboardingPersonaColours.Yellow, [PersonaColour.Green]: UserOnboardingPersonaColours.Green, [PersonaColour.Blue]: UserOnboardingPersonaColours.Blue };
	return colours[colour];
}

/** Project one conversation without leaking Prisma-generated models. */
function _ProjectConversation(conversation: Prisma.UserOnboardingBootstrapConversationGetPayload<{ include: { contentRevision: { include: { questions: true } }; answers: true } }>): UserOnboardingBootstrapConversation
{
	return { id: conversation.id, onboardingId: conversation.onboardingId, siloId: conversation.siloId, subjectId: conversation.userId, personaRevisionId: conversation.personaRevisionId, personaDisplayName: conversation.personaDisplayName, personaArchetype: _ProjectArchetype(conversation.personaArchetype), content: _ProjectContent(conversation.contentRevision), answers: conversation.answers.map(function _Answer(answer) { return { id: answer.id, ordinal: answer.ordinal, questionOrdinal: answer.questionOrdinal, text: answer.text, idempotencyKey: answer.idempotencyKey, answeredAt: answer.answeredAt }; }), startedAt: conversation.startedAt };
}

/** Recognise only expected compare-and-set or uniqueness races. */
function _ExpectedConflict(err: unknown): boolean
{
	if (err instanceof Prisma.PrismaClientKnownRequestError) return err.code === "P2002" || err.code === "P2025";
	return err instanceof Prisma.PrismaClientUnknownRequestError && err.message.includes(_BOOTSTRAP_CONVERSATION_PENDING_TRIGGER);
}
