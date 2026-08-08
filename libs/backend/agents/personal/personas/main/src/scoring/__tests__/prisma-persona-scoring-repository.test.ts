import { PersonaColour, PersonaTieKind, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { __ResolvePersonaInterviewTie } from "../../interview/persona-interview-authority.js";
import { PrismaPersonaInterviewRepository } from "../../interview/prisma-persona-interview-repository.js";
import { PersonaColourValues, PersonaTieKinds } from "../persona-scorer.types.js";

describe("persona scoring repository", function _describePersonaScoringRepository()
{
	it("persists scorer-ordered candidates and returns the owner's selected tie result", async function _persistsScorerCandidates()
	{
		const createScore = vi.fn().mockResolvedValue({ interviewId: "interview-1" });
		const createResolution = vi.fn().mockResolvedValue({ id: "resolution-1" });
		const answers = Array.from({ length: 10 }, function _Answer(_, index)
		{
			const ordinal = index + 1;
			return { id: `answer-${ordinal}`, questionId: `q${ordinal}`, choiceId: "a", choice: { question: { ordinal }, weights: [{ red: 2, yellow: 1, green: 0, blue: 2, explorer: 1, guardian: 0 }] } };
		});
		const transaction = {
			personaInterview: { findFirst: vi.fn().mockResolvedValue({ scoringPolicyId: "policy", scoringPolicyVersion: 1, scoringPolicy: { digest: "sha256:policy" } }) },
			personaInterviewAnswer: { findMany: vi.fn().mockResolvedValue(answers) },
			personaInterviewScore: { findUnique: vi.fn().mockResolvedValue(null), create: createScore },
			personaTieResolution: { findMany: vi.fn().mockResolvedValue([]), create: createResolution },
		};
		const repository = new PrismaPersonaInterviewRepository(transaction as unknown as Prisma.TransactionClient);

		const result = await __ResolvePersonaInterviewTie(repository, { userId: "user-1", personaProfileId: "profile-1", interviewId: "interview-1", kind: PersonaTieKinds.Primary, selectedValue: PersonaColourValues.Blue, resolvedAt: "2026-08-08T10:00:00.000Z" });

		expect(createScore).toHaveBeenCalledWith({ data: expect.objectContaining({ primaryCandidates: [PersonaColour.Red, PersonaColour.Blue], secondaryCandidates: [], modifierCandidates: [] }) });
		expect(createResolution).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: PersonaTieKind.Primary, candidates: [PersonaColourValues.Red, PersonaColourValues.Blue], selectedValue: PersonaColourValues.Blue, resolvedBy: "user-1" }) });
		expect(result).toMatchObject({ outcome: "recorded", score: { primary: PersonaColourValues.Blue, secondary: PersonaColourValues.Red, resolutionRequired: null } });
	});
});
