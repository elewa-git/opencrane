import { PersonaColour, PersonaOpennessModifier, PersonaRevisionState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PersonaOnboardingApiStates } from "../persona-lifecycle.types.js";
import { PrismaPersonaOnboardingStatusRepository } from "../prisma-persona-onboarding-status-repository.js";

/** Build a status-reader Prisma double with an old active revision and a newer retake interview. */
function _prisma(interviewState: string): Prisma.TransactionClient
{
	return { personaProfile: { findUnique: vi.fn().mockResolvedValue({ id: "profile-1", activeRevisionId: "old-approved", interviews: [{ id: "retake-1", answers: [{ questionId: "role", choiceId: "a" }], questionSet: { questions: [{ id: "role", category: "Pace", prompt: "Role", ordinal: 1, choices: [] }, { id: "tone", category: "Tone", prompt: "Tone", ordinal: 2, choices: [] }] }, state: interviewState }] }) }, personaRevision: { findFirst: vi.fn().mockResolvedValue(null) }, personaInterview: { findFirst: vi.fn().mockResolvedValue(null) } } as unknown as Prisma.TransactionClient;
}

/** Build a status-reader Prisma double whose draft carries the supplied durable JSON. */
function _prismaWithRevision(scoringEvidence: Prisma.JsonValue): Prisma.TransactionClient
{
	return {
		personaProfile: { findUnique: vi.fn().mockResolvedValue({ id: "profile-1", activeRevisionId: null, interviews: [{ id: "interview-1", answers: [], questionSet: { questions: [] }, state: "Completed" }] }) },
		personaRevision: { findFirst: vi.fn().mockResolvedValue({ id: "revision-1", state: PersonaRevisionState.Draft, primaryColour: PersonaColour.Red, secondaryColour: PersonaColour.Blue, modifier: PersonaOpennessModifier.Explorer, compiledInstructions: "instructions", soulTemplate: { displayName: "Commander" }, scoringEvidence, insights: [] }) },
	} as unknown as Prisma.TransactionClient;
}

describe("PrismaPersonaOnboardingStatusRepository", function _suite()
{
	it("prioritizes an in-progress retake over an older active approved revision", async function _retake()
	{
		const repository = new PrismaPersonaOnboardingStatusRepository(_prisma("InProgress"));
		await expect(repository.readStatus("silo-1", "user-1")).resolves.toEqual({ state: PersonaOnboardingApiStates.Interview, interviewId: "retake-1", answeredQuestionCount: 1, questionCount: 2, personaRevisionId: null, questions: [{ id: "role", category: "Pace", prompt: "Role", ordinal: 1, choices: [], selectedChoiceId: "a" }, { id: "tone", category: "Tone", prompt: "Tone", ordinal: 2, choices: [], selectedChoiceId: null }], resolution: null, result: null });
	});

	it("keeps a completed retake resumable until it has a new draft", async function _completedRetake()
	{
		const repository = new PrismaPersonaOnboardingStatusRepository(_prisma("Completed"));
		await expect(repository.readStatus("silo-1", "user-1")).resolves.toEqual({ state: PersonaOnboardingApiStates.Interview, interviewId: "retake-1", answeredQuestionCount: 1, questionCount: 2, personaRevisionId: null, questions: [{ id: "role", category: "Pace", prompt: "Role", ordinal: 1, choices: [], selectedChoiceId: "a" }, { id: "tone", category: "Tone", prompt: "Tone", ordinal: 2, choices: [], selectedChoiceId: null }], resolution: null, result: null });
	});

	it("fails closed when a draft carries malformed durable scoring evidence", async function _invalidDraftEvidence()
	{
		const repository = new PrismaPersonaOnboardingStatusRepository(_prismaWithRevision({ colours: { red: 2, yellow: 1, green: 0, blue: 2, total: 99 } }));

		await expect(repository.readStatus("silo-1", "user-1")).rejects.toThrow("invalid scoring evidence");
	});
});
