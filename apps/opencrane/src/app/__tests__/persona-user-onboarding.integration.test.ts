import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@opencrane/backend/observability";

import { __CreatePersonaOnboardingRouter, type PersonaOnboardingRouterDependencies } from "@opencrane/backend/agents/personal/personas";
import { __CreateUserOnboardingRouter, __UserOnboardingAuthority, UserOnboardingStates, type ApprovedPersonaEvidence, type UserOnboardingOwner, type UserOnboardingRecord } from "@opencrane/backend/server/agents/onboarding";

import { _CreatePersonaOnboardingWorkflow } from "../user-onboarding-composition.js";

/** Stable owner shared by both routers through the app composition vocabulary adapter. */
const _OWNER: UserOnboardingOwner = { siloId: "silo-1", subjectId: "user-1" };

/** Build the initial durable workflow row. */
function _PendingRecord(): UserOnboardingRecord
{
	const startedAt = new Date("2026-08-08T10:00:00.000Z");
	return { id: "onboarding-1", siloId: _OWNER.siloId, subjectId: _OWNER.subjectId, workflowVersion: 1, state: UserOnboardingStates.SurveyPending, personaInterviewId: null, personaRevisionId: null, bootstrapConversationId: null, bootstrapContentRevisionId: null, bootstrapContentDigest: null, completionProvenance: null, completionMigrationRevision: null, completionMigrationBatch: null, startedAt, surveyStartedAt: null, completedAt: null, updatedAt: startedAt };
}

describe("persona and durable onboarding app composition", function _PersonaUserOnboardingCompositionSuite()
{
	it("recovers interrupted sort and approval notifications without regressing later refreshes", async function _RecoversCrossAuthorityRetries()
	{
		let onboarding = _PendingRecord();
		let failNextInterviewReplacement = true;
		let failNextApprovalTransition = true;
		let approvalState = "draft";
		let activeRevisionId: string | null = null;
		const onboardingRepository = {
			async ensure(): Promise<UserOnboardingRecord> { return onboarding; },
			async read(owner: UserOnboardingOwner): Promise<UserOnboardingRecord | null> { return owner.siloId === _OWNER.siloId && owner.subjectId === _OWNER.subjectId ? onboarding : null; },
			async markSurveyInProgress(owner: UserOnboardingOwner, interviewId: string): Promise<boolean>
			{
				if (owner.siloId !== _OWNER.siloId || owner.subjectId !== _OWNER.subjectId || onboarding.state !== UserOnboardingStates.SurveyPending) return false;
				onboarding = { ...onboarding, state: UserOnboardingStates.SurveyInProgress, personaInterviewId: interviewId, surveyStartedAt: new Date("2026-08-08T10:01:00.000Z") };
				return true;
			},
			async replaceSurveyInterview(owner: UserOnboardingOwner, expectedInterviewId: string, replacementInterviewId: string): Promise<boolean>
			{
				if (failNextInterviewReplacement) { failNextInterviewReplacement = false; throw new Error("induced onboarding replacement interruption"); }
				if (owner.siloId !== _OWNER.siloId || owner.subjectId !== _OWNER.subjectId || onboarding.state !== UserOnboardingStates.SurveyInProgress || onboarding.personaInterviewId !== expectedInterviewId || onboarding.personaRevisionId !== null) return false;
				onboarding = { ...onboarding, personaInterviewId: replacementInterviewId };
				return true;
			},
			async markPersonaApproved(owner: UserOnboardingOwner, evidence: ApprovedPersonaEvidence): Promise<boolean>
			{
				if (failNextApprovalTransition) { failNextApprovalTransition = false; throw new Error("induced onboarding persistence interruption"); }
				if (owner.siloId !== _OWNER.siloId || owner.subjectId !== _OWNER.subjectId || onboarding.state !== UserOnboardingStates.SurveyInProgress || onboarding.personaInterviewId !== evidence.interviewId) return false;
				onboarding = { ...onboarding, state: UserOnboardingStates.BootstrapChatPending, personaRevisionId: evidence.personaRevisionId };
				return true;
			},
		};
		const personaEvidence = {
			async ownsInterview(owner: UserOnboardingOwner, interviewId: string): Promise<boolean> { return owner.siloId === _OWNER.siloId && owner.subjectId === _OWNER.subjectId && ["interview-a", "interview-b", "interview-c"].includes(interviewId); },
			async readApprovedPersona(owner: UserOnboardingOwner, evidence: ApprovedPersonaEvidence): Promise<ApprovedPersonaEvidence | null>
			{
				if (!await this.ownsInterview(owner, evidence.interviewId) || approvalState !== "approved" || activeRevisionId !== evidence.personaRevisionId) return null;
				return evidence;
			},
			async readLatestApprovedPersona(owner: UserOnboardingOwner, interviewId: string): Promise<ApprovedPersonaEvidence | null>
			{
				if (!await this.ownsInterview(owner, interviewId) || approvalState !== "approved" || activeRevisionId === null) return null;
				return { interviewId, personaRevisionId: activeRevisionId };
			},
		};
		const authority = new __UserOnboardingAuthority(onboardingRepository, personaEvidence, 1);
		const workflow = _CreatePersonaOnboardingWorkflow(authority);
		const approveAndActivateAtomically = vi.fn();
		approveAndActivateAtomically.mockImplementation(async function _Approve()
		{
			approvalState = "approved";
			activeRevisionId = "revision-b";
			return { status: "approved" };
		});
		const startAtomically = vi.fn()
			.mockResolvedValueOnce({ status: "started", interviewId: "interview-a" })
			.mockResolvedValueOnce({ status: "started", interviewId: "interview-b" })
			.mockResolvedValueOnce({ status: "already_in_progress", interviewId: "interview-b" })
			.mockResolvedValueOnce({ status: "started", interviewId: "interview-c" });
		const recordAnswerAtomically = vi.fn().mockResolvedValue({ status: "recorded", answerId: "answer-b" });
		const logger = { error: vi.fn() } as unknown as Logger;
		const personaDependencies: PersonaOnboardingRouterDependencies = {
			resolveCaller: function _Caller() { return { siloId: _OWNER.siloId, userId: _OWNER.subjectId }; },
			onboarding: { ensureAtomically: vi.fn().mockResolvedValue({ outcome: "ready", personaProfileId: "profile-1", questionSet: { id: "personal-agent-onboarding", version: 1 }, derivation: { scoringPolicyId: "policy", scoringPolicyVersion: 1, interpolationMapId: "map", interpolationMapVersion: 1 } }) },
			interviews: { startAtomically, recordAnswerAtomically, completeAtomically: vi.fn(), resolveTieAtomically: vi.fn() },
			questions: { getQuestions: vi.fn().mockResolvedValue([{ id: "q1", category: "Pace", prompt: "How should we work?", ordinal: 1, choices: [{ id: "a", label: "Directly", ordinal: 1 }] }]) },
			drafts: { createFromInterviewAtomically: vi.fn() },
			approval: {
				getApprovalSnapshot: vi.fn().mockImplementation(async function _Snapshot()
				{
					return { profileUserId: _OWNER.subjectId, activeRevisionId, revisionState: approvalState, revisionProfileId: "profile-1", interviewState: "completed", insightCount: 3, templateDigestMatches: true, templateSelectionMatches: true, durableSoulMutationPolicy: "forbidden" };
				}),
				approveAndActivateAtomically,
			},
			clock: { now: function _Now() { return new Date("2026-08-08T10:02:00.000Z"); } },
			logger,
			status: { readStatus: vi.fn().mockResolvedValue({ state: "review", interviewId: "interview-b", answeredQuestionCount: 10, questionCount: 10, personaRevisionId: "revision-b", questions: [], resolution: null, result: null }) },
			workflow,
		};
		const app = express();
		app.use(express.json());
		app.use("/api/v1/me/persona", __CreatePersonaOnboardingRouter(personaDependencies));
		app.use("/api/v1/me/onboarding", __CreateUserOnboardingRouter({ authority, resolveOwner: function _OwnerResolver() { return _OWNER; }, logger }));

		await request(app).post("/api/v1/me/persona/interview").send({}).expect(200);
		await request(app).post("/api/v1/me/persona/interview").send({}).expect(503);
		expect(onboarding.personaInterviewId).toBe("interview-a");
		await request(app).post("/api/v1/me/persona/interview").send({}).expect(200);
		expect(onboarding.personaInterviewId).toBe("interview-b");
		await request(app).post("/api/v1/me/persona/interviews/interview-b/answers/q1").send({ choiceId: "a" }).expect(201);
		expect(recordAnswerAtomically).toHaveBeenCalledTimes(1);

		await request(app).post("/api/v1/me/persona/drafts/revision-b/approve").send({}).expect(503);
		expect(approvalState).toBe("approved");
		expect(onboarding.state).toBe(UserOnboardingStates.SurveyInProgress);
		await request(app).post("/api/v1/me/persona/drafts/revision-b/approve").send({}).expect(200);
		expect(approveAndActivateAtomically).toHaveBeenCalledTimes(1);

		await request(app).post("/api/v1/me/persona/refreshes/change-1/interview").send({}).expect(200);
		const durable = await request(app).get("/api/v1/me/onboarding/").expect(200);
		expect(durable.body).toMatchObject({ state: UserOnboardingStates.BootstrapChatPending, personaInterviewId: "interview-b", personaRevisionId: "revision-b" });
	});
});
