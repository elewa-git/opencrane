import { Prisma, UserOnboardingCompletionProvenance, UserOnboardingState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaUserOnboardingRepository } from "../prisma-user-onboarding-repository.js";
import { UserOnboardingCompletionProvenances, UserOnboardingStates } from "../user-onboarding.enums.js";

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
	return new PrismaUserOnboardingRepository({ userOnboarding: delegate } as unknown as Prisma.TransactionClient);
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
			create: { siloId: "silo-a", userId: "subject-a", workflowVersion: 3 },
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
});
