import { PersonaColour, PersonaRevisionState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PersonaWorkflowColours } from "../persona-workflow-evidence.types.js";
import { PrismaPersonaWorkflowEvidenceRepository } from "../prisma-persona-workflow-evidence.js";

describe("PrismaPersonaWorkflowEvidenceRepository", function _PrismaPersonaWorkflowEvidenceRepositorySuite()
{
	it("returns an approved pinned revision after a later persona refresh becomes active", async function _ReadsInactivePinnedRevision()
	{
		const findFirst = vi.fn().mockResolvedValue({ id: "revision-pinned", primaryColour: PersonaColour.Red, soulTemplate: { displayName: "The Commander" } });
		const repository = new PrismaPersonaWorkflowEvidenceRepository({ personaRevision: { findFirst } } as unknown as Prisma.TransactionClient);

		const evidence = await repository.readApprovedBootstrapEvidence({ siloId: "silo-a", subjectId: "subject-a" }, "revision-pinned");

		expect(findFirst).toHaveBeenCalledWith({
			where: { id: "revision-pinned", state: PersonaRevisionState.Approved, profile: { siloId: "silo-a", userId: "subject-a" } },
			select: { id: true, primaryColour: true, soulTemplate: { select: { displayName: true } } },
		});
		expect(evidence).toEqual({ personaRevisionId: "revision-pinned", displayName: "The Commander", primaryColour: PersonaWorkflowColours.Red });
	});
});
