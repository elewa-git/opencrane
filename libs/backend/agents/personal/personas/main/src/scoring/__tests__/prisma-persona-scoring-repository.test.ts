import { PersonaColour, PersonaTieKind, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { __ResolvePersonaInterviewTie } from "../../interview/persona-interview-authority";
import { PrismaPersonaInterviewRepository } from "../../interview/prisma-persona-interview-repository";
import { PersonaScoringPersistenceStatuses } from "../persona-scoring-repository.types";
import { PrismaPersonaScoringRepository } from "../prisma-persona-scoring-repository";
import { PersonaColourValues, PersonaTieKinds } from "../persona-scorer.types";

/** Build the ten exact weighted answers used by repository replay tests. */
function _Answers()
{
	return Array.from({ length: 10 }, function _Answer(_, index)
	{
		const ordinal = index + 1;
		return { id: `answer-${ordinal}`, questionId: `q${ordinal}`, choiceId: "a", choice: { question: { ordinal }, weights: [{ red: 2, yellow: 1, green: 0, blue: 2, explorer: 1, guardian: 0 }] } };
	});
}

/** Build the immutable initial-score row expected for the shared answer fixture. */
function _StoredScore(secondaryCandidates: readonly PersonaColour[])
{
	return { scoringPolicyId: "policy", scoringPolicyVersion: 1, scoringPolicyDigest: "sha256:policy", orderedAnswerIds: _Answers().map(function _Id(answer) { return answer.id; }), orderedChoiceIds: _Answers().map(function _Choice(answer) { return `${answer.questionId}:${answer.choiceId}`; }), red: 20, yellow: 10, green: 0, blue: 20, colourTotal: 50, explorer: 10, guardian: 0, opennessTotal: 10, primaryCandidates: [PersonaColour.Red, PersonaColour.Blue], secondaryCandidates, modifierCandidates: [] };
}

describe("persona scoring repository", function _describePersonaScoringRepository()
{
	it("persists scorer-ordered candidates and returns the owner's selected tie result", async function _persistsScorerCandidates()
	{
		const createScore = vi.fn().mockResolvedValue({ interviewId: "interview-1" });
		const createResolution = vi.fn().mockResolvedValue({ id: "resolution-1" });
		const transaction = {
			personaInterview: { findFirst: vi.fn().mockResolvedValue({ scoringPolicyId: "policy", scoringPolicyVersion: 1, scoringPolicy: { digest: "sha256:policy" } }) },
			personaInterviewAnswer: { findMany: vi.fn().mockResolvedValue(_Answers()) },
			personaInterviewScore: { findUnique: vi.fn().mockResolvedValue(null), create: createScore },
			personaTieResolution: { findMany: vi.fn().mockResolvedValue([]), create: createResolution },
		};
		const repository = new PrismaPersonaInterviewRepository(transaction as unknown as Prisma.TransactionClient);

		const result = await __ResolvePersonaInterviewTie(repository, { siloId: "silo-1", principalId: "principal-1", userId: "user-1", personaProfileId: "profile-1", interviewId: "interview-1", kind: PersonaTieKinds.Primary, selectedValue: PersonaColourValues.Blue, resolvedAt: "2026-08-08T10:00:00.000Z" });

		expect(createScore).toHaveBeenCalledWith({ data: expect.objectContaining({ primaryCandidates: [PersonaColour.Red, PersonaColour.Blue], secondaryCandidates: [], modifierCandidates: [] }) });
		expect(createResolution).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: PersonaTieKind.Primary, candidates: [PersonaColourValues.Red, PersonaColourValues.Blue], selectedValue: PersonaColourValues.Blue, resolvedBy: "user-1" }) });
		expect(result).toMatchObject({ outcome: "recorded", score: { primary: PersonaColourValues.Blue, secondary: PersonaColourValues.Red, resolutionRequired: null } });
	});

	it("replays resolved scores against the immutable initial candidate evidence", async function _replaysInitialCandidates()
	{
		const transaction = {
			personaInterview: { findFirst: vi.fn().mockResolvedValue({ scoringPolicyId: "policy", scoringPolicyVersion: 1, scoringPolicy: { digest: "sha256:policy" } }) },
			personaInterviewAnswer: { findMany: vi.fn().mockResolvedValue(_Answers()) },
			personaInterviewScore: { findUnique: vi.fn().mockResolvedValue(_StoredScore([])) },
			personaTieResolution: { findMany: vi.fn().mockResolvedValue([{ kind: PersonaTieKind.Primary, candidates: [PersonaColourValues.Red, PersonaColourValues.Blue], selectedValue: PersonaColourValues.Blue }]) },
		};
		const repository = new PrismaPersonaScoringRepository(transaction as unknown as Prisma.TransactionClient);

		const result = await repository.readScore("interview-1", "profile-1", "user-1");

		expect(result).toMatchObject({ status: PersonaScoringPersistenceStatuses.Ready, score: { primary: PersonaColourValues.Blue, secondary: PersonaColourValues.Red } });
	});

	it("rejects a stored secondary candidate set that differs from the initial replay", async function _rejectsCandidateDrift()
	{
		const transaction = {
			personaInterview: { findFirst: vi.fn().mockResolvedValue({ scoringPolicyId: "policy", scoringPolicyVersion: 1, scoringPolicy: { digest: "sha256:policy" } }) },
			personaInterviewAnswer: { findMany: vi.fn().mockResolvedValue(_Answers()) },
			personaInterviewScore: { findUnique: vi.fn().mockResolvedValue(_StoredScore([PersonaColour.Red])) },
			personaTieResolution: { findMany: vi.fn().mockResolvedValue([]) },
		};
		const repository = new PrismaPersonaScoringRepository(transaction as unknown as Prisma.TransactionClient);

		await expect(repository.readScore("interview-1", "profile-1", "user-1")).resolves.toEqual({ status: PersonaScoringPersistenceStatuses.InvalidEvidence });
	});
});
