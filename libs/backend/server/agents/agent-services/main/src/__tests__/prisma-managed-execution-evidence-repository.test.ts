import { AgentRevisionState, AgentServiceKind, AgentServiceState, PrincipalProvenance } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaManagedExecutionEvidenceRepository } from "../db/prisma-managed-execution-evidence-repository";

/** Supplies the smallest published company revision; unsupported extensions remain refused explicitly. */
function _Row()
{
	return { id: "service-1", principalId: "company-principal", name: "Company", workloadProfile: "company", activeRevisionId: "revision-1", activeRevision: { id: "revision-1", siloId: "silo-1", agentServiceId: "service-1", state: AgentRevisionState.Published, digest: "sha256:revision", personaRevisionId: null, modelDefinitionId: "model-1", budget: { maxDurationMs: 60_000 }, skillAssignments: [], mcpToolAssignments: [], boundaryAttachments: [] } };
}

describe("PrismaManagedExecutionEvidenceRepository", function _Suite()
{
	it("requires the exact active Managed service and its own same-silo Internal Principal", async function _ReadsOwnPrincipal()
	{
		const findFirst = vi.fn().mockResolvedValue(_Row());
		const repository = new PrismaManagedExecutionEvidenceRepository({ agentService: { findFirst } } as never, {} as never);
		expect(await repository.loadCurrent("silo-1", "service-1")).toMatchObject({ agentRevisionId: "revision-1", principalId: "company-principal", agentRevisionDigest: "sha256:revision" });
		expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "service-1", siloId: "silo-1", kind: AgentServiceKind.Managed, state: AgentServiceState.Active, principal: { is: { siloId: "silo-1", provenance: PrincipalProvenance.Internal } } } }));
	});

	it("returns canonical exact MCP assignments for the company principal", async function _LoadsTools()
	{
		const row = _Row();
		const findFirst = vi.fn().mockResolvedValue({ ...row, activeRevision: { ...row.activeRevision, mcpToolAssignments: [{ toolRevisionId: "tool-z" }, { toolRevisionId: "tool-a" }] } });
		const repository = new PrismaManagedExecutionEvidenceRepository({ agentService: { findFirst } } as never, {} as never);
		await expect(repository.loadCurrent("silo-1", "service-1")).resolves.toMatchObject({ principalId: "company-principal", mcpToolRevisionIds: ["tool-a", "tool-z"] });
	});

	it.each([
		{ state: AgentRevisionState.Draft }, { id: "other-revision" }, { siloId: "other-silo" }, { agentServiceId: "other-service" }, { personaRevisionId: "personal-persona" }, { skillAssignments: [{ skillId: "skill" }] }, { boundaryAttachments: [{ id: "memory-boundary" }] },
	])("rejects an unpublished, substituted or extended revision %j", async function _RejectsRevision(patch)
	{
		const row = _Row();
		const findFirst = vi.fn().mockResolvedValue({ ...row, activeRevision: { ...row.activeRevision, ...patch } });
		const repository = new PrismaManagedExecutionEvidenceRepository({ agentService: { findFirst } } as never, {} as never);
		await expect(repository.loadCurrent("silo-1", "service-1")).resolves.toBeNull();
	});
});
