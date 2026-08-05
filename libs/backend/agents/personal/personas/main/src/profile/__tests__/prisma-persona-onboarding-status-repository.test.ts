import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PersonaOnboardingApiStates } from "../persona-lifecycle.types.js";
import { PrismaPersonaOnboardingStatusRepository } from "../prisma-persona-onboarding-status-repository.js";

/** Build a status-reader Prisma double with an old active revision and a newer retake interview. */
function _prisma(interviewState: string): Prisma.TransactionClient
{
	return { personaProfile: { findUnique: vi.fn().mockResolvedValue({ id: "profile-1", activeRevisionId: "old-approved", interviews: [{ id: "retake-1", answers: [{ id: "answer-1" }], questionSet: { questions: [{ id: "role" }, { id: "tone" }] }, state: interviewState }] }) }, personaRevision: { findFirst: vi.fn().mockResolvedValue(null) } } as unknown as Prisma.TransactionClient;
}

describe("PrismaPersonaOnboardingStatusRepository", function _suite()
{
	it("prioritizes an in-progress retake over an older active approved revision", async function _retake()
	{
		const repository = new PrismaPersonaOnboardingStatusRepository(_prisma("InProgress"));
		await expect(repository.readStatus("silo-1", "user-1")).resolves.toEqual({ state: PersonaOnboardingApiStates.Interview, interviewId: "retake-1", answeredQuestionCount: 1, questionCount: 2, personaRevisionId: null });
	});

	it("keeps a completed retake resumable until it has a new draft", async function _completedRetake()
	{
		const repository = new PrismaPersonaOnboardingStatusRepository(_prisma("Completed"));
		await expect(repository.readStatus("silo-1", "user-1")).resolves.toEqual({ state: PersonaOnboardingApiStates.Interview, interviewId: "retake-1", answeredQuestionCount: 1, questionCount: 2, personaRevisionId: null });
	});
});
