import { UserOnboardingCompletionProvenance, UserOnboardingState, type Prisma } from "@prisma/client";

import { UserOnboardingCompletionProvenances, UserOnboardingStates } from "./user-onboarding.enums";
import type { UserOnboardingCompletionEvidence, UserOnboardingCompletionRepository } from "./user-onboarding-completion.types";
import type { UserOnboardingOwner } from "./user-onboarding.types";

/** Prisma adapter for onboarding-owned evidence and its final completion write. */
export class PrismaUserOnboardingCompletionRepository implements UserOnboardingCompletionRepository
{
	/** Transaction client supplied by the completion unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Bind this repository to exactly one Serializable transaction attempt. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** @inheritdoc */
	async readEvidence(owner: UserOnboardingOwner): Promise<UserOnboardingCompletionEvidence | null>
	{
		const row = await this.transaction.userOnboarding.findUnique({
			where: { siloId_userId: { siloId: owner.siloId, userId: owner.subjectId } },
			select: {
				id: true,
				siloId: true,
				userId: true,
				state: true,
				completionProvenance: true,
				personaRevisionId: true,
				bootstrapConversationId: true,
				bootstrapContentRevisionId: true,
				bootstrapContentDigest: true,
				bootstrapConversation: {
					select: {
						id: true,
						onboardingId: true,
						siloId: true,
						userId: true,
						personaRevisionId: true,
						contentRevisionId: true,
						contentDigest: true,
						answers: { select: { questionOrdinal: true }, orderBy: { questionOrdinal: "asc" } },
						contentRevision: { select: { questions: { select: { ordinal: true }, orderBy: { ordinal: "asc" } } } },
					},
				},
			},
		});
		if (row === null) return null;
		const conversation = row.bootstrapConversation;
		const pinsMatch = conversation !== null
			&& conversation.id === row.bootstrapConversationId
			&& conversation.onboardingId === row.id
			&& conversation.siloId === row.siloId
			&& conversation.userId === row.userId
			&& conversation.personaRevisionId === row.personaRevisionId
			&& conversation.contentRevisionId === row.bootstrapContentRevisionId
			&& conversation.contentDigest === row.bootstrapContentDigest
			&& conversation.contentRevision.questions.every(function _OrderedQuestion(question, index) { return question.ordinal === index + 1; });
		return {
			onboardingId: row.id,
			siloId: row.siloId,
			subjectId: row.userId,
			state: _State(row.state),
			completionProvenance: _Provenance(row.completionProvenance),
			conversationId: row.bootstrapConversationId,
			personaRevisionId: row.personaRevisionId,
			bootstrapPinsMatch: pinsMatch,
			questionCount: conversation?.contentRevision.questions.length ?? 0,
			answeredQuestionOrdinals: conversation?.answers.map(function _Ordinal(answer) { return answer.questionOrdinal; }) ?? [],
		};
	}

	/** @inheritdoc */
	async markCompleted(owner: UserOnboardingOwner, conversationId: string, completedAt: Date): Promise<boolean>
	{
		const updated = await this.transaction.userOnboarding.updateMany({
			where: { siloId: owner.siloId, userId: owner.subjectId, state: UserOnboardingState.BootstrapChatInProgress, bootstrapConversationId: conversationId },
			data: { state: UserOnboardingState.Completed, completionProvenance: UserOnboardingCompletionProvenance.BootstrapConcluded, completedAt },
		});
		return updated.count === 1;
	}
}

/** Map Prisma state into the onboarding package vocabulary. */
function _State(state: UserOnboardingState): UserOnboardingStates
{
	const values: Record<UserOnboardingState, UserOnboardingStates> = {
		[UserOnboardingState.SurveyPending]: UserOnboardingStates.SurveyPending,
		[UserOnboardingState.SurveyInProgress]: UserOnboardingStates.SurveyInProgress,
		[UserOnboardingState.BootstrapChatPending]: UserOnboardingStates.BootstrapChatPending,
		[UserOnboardingState.BootstrapChatInProgress]: UserOnboardingStates.BootstrapChatInProgress,
		[UserOnboardingState.Completed]: UserOnboardingStates.Completed,
	};
	return values[state];
}

/** Map Prisma completion provenance without leaking generated enums. */
function _Provenance(value: UserOnboardingCompletionProvenance | null): UserOnboardingCompletionProvenances | null
{
	if (value === null) return null;
	const values: Record<UserOnboardingCompletionProvenance, UserOnboardingCompletionProvenances> = {
		[UserOnboardingCompletionProvenance.BootstrapConcluded]: UserOnboardingCompletionProvenances.BootstrapConcluded,
		[UserOnboardingCompletionProvenance.ExistingUserMigration]: UserOnboardingCompletionProvenances.ExistingUserMigration,
	};
	return values[value];
}
