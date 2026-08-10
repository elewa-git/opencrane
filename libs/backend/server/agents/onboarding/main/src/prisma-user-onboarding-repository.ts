import { Prisma, type PrismaClient, UserOnboardingCompletionProvenance, UserOnboardingState } from "@prisma/client";

import { UserOnboardingCompletionProvenances, UserOnboardingStates } from "./user-onboarding.enums.js";
import type { ApprovedPersonaEvidence, UserOnboardingOwner, UserOnboardingRecord, UserOnboardingRepository } from "./user-onboarding.types.js";

/** App-composed user-onboarding repository backed by the canonical product database. */
export function _CreateUserOnboardingRepository(prisma: PrismaClient): UserOnboardingRepository
{
	return new PrismaUserOnboardingRepository(prisma);
}

/** Prisma persistence adapter that can mutate only the UserOnboarding authority. */
export class PrismaUserOnboardingRepository implements UserOnboardingRepository
{
	/** Transaction-scoped canonical product database capability. */
	private readonly prisma: Prisma.TransactionClient;

	/** Create an onboarding repository at the reviewed persistence boundary. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Return the existing pinned workflow or create the current survey-pending version once. */
	async ensure(owner: UserOnboardingOwner, currentWorkflowVersion: number): Promise<UserOnboardingRecord>
	{
		const row = await this.prisma.userOnboarding.upsert({
			where: { siloId_userId: _OwnerKey(owner) },
			create: { siloId: owner.siloId, userId: owner.subjectId, workflowVersion: currentWorkflowVersion },
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
}

/** Build the exact compound owner key used for every persistence lookup. */
function _OwnerKey(owner: UserOnboardingOwner): { siloId: string; userId: string }
{
	return { siloId: owner.siloId, userId: owner.subjectId };
}

/** Translate the Prisma-owned enum into the package's stable domain vocabulary. */
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

/** Translate nullable Prisma completion provenance into the stable domain vocabulary. */
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
