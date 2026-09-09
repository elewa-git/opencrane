import { AgentRevisionState, AgentServiceKind, AgentServiceState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaPersonalExecutionEvidenceRepository } from "../db/prisma-personal-execution-evidence-repository";

/** Deployment membership config is unused by revision-only repository tests. */
const _MEMBERSHIP = { mode: "fleet", trustedIssuerId: "fleet-1", maximumStalenessMs: 10_000, verifier: { verify: vi.fn() } } as never;

describe("PrismaPersonalExecutionEvidenceRepository", function _Suite()
{
	it("loads only the exact active Personal service and its published revision", async function _LoadsExactRevision()
	{
		const row = { id: "revision-1", digest: "sha256:revision", modelDefinitionId: "model-1", budget: {}, boundaryAttachments: [], skillAssignments: [], mcpToolAssignments: [{ toolRevisionId: "tool-1" }] };
		const prisma = { agentRevision: { findFirst: vi.fn().mockResolvedValue(row) } };
		const repository = new PrismaPersonalExecutionEvidenceRepository(prisma as never, _MEMBERSHIP);
		await expect(repository.loadActiveRevision("silo-1", "service-1", "revision-1")).resolves.toEqual({ id: "revision-1", digest: "sha256:revision", modelDefinitionId: "model-1", budget: {}, boundaryAttachments: [], skillAssignments: [], mcpToolRevisionIds: ["tool-1"] });
		expect(prisma.agentRevision.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "revision-1", siloId: "silo-1", agentServiceId: "service-1", state: AgentRevisionState.Published, agentService: { is: { id: "service-1", siloId: "silo-1", kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: "revision-1" } } } }));
	});

	it("returns null instead of constructing evidence when the exact revision is unavailable", async function _RejectsMissingRevision()
	{
		const prisma = { agentRevision: { findFirst: vi.fn().mockResolvedValue(null) } };
		const repository = new PrismaPersonalExecutionEvidenceRepository(prisma as never, _MEMBERSHIP);
		await expect(repository.loadActiveRevision("silo-1", "service-1", "revision-1")).resolves.toBeNull();
	});
});
