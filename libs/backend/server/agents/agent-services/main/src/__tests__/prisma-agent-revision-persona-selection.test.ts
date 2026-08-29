import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { AgentRevisionPersonaSelectionMaterializationCodes } from "../agent-revision-persona-selection.types";
import { PrismaAgentRevisionPersonaSelectionRepository } from "../db/prisma-agent-revision-persona-selection";

/** Builds one complete published source revision for clone assertions. */
function _Source(personaRevisionId = "persona-old")
{
	return {
		id: "agent-revision-1",
		agentServiceId: "service-1",
		revision: 7,
		parentRevisionId: null,
		sourceRevisionId: null,
		changeMessage: "initial",
		state: "Published",
		digest: "sha256:old",
		promptPolicyVersion: "prompt-v1",
		personaRevisionId,
		modelDefinitionId: "model-1",
		budget: { maxTurns: 64, maxTokens: 256_000, maxDurationMs: 3_600_000 },
		authoredBy: "user-1",
		createdAt: new Date("2026-08-17T08:00:00.000Z"),
		publishedAt: new Date("2026-08-17T08:00:00.000Z"),
		skillAssignments: [],
		mcpToolAssignments: [],
		boundaryAttachments: [],
	};
}

/** Builds a transaction fake and exposes the spies used by persona-selection tests. */
function _Transaction(options: { readonly sourcePersonaId?: string; readonly services?: readonly { readonly id: string; readonly activeRevisionId: string | null }[]; readonly activeRevisionId?: string } = {})
{
	const source = _Source(options.sourcePersonaId);
	const personaFindFirst = vi.fn()
		.mockResolvedValueOnce({ personaProfileId: "profile-1" })
		.mockResolvedValueOnce({ personaProfileId: "profile-1" });
	const agentRevisionFindFirst = vi.fn()
		.mockResolvedValueOnce(source)
		.mockResolvedValueOnce({ id: source.id });
	const agentRevisionCreate = vi.fn().mockResolvedValue({ ...source, id: "agent-revision-2", revision: 8, personaRevisionId: "persona-new" });
	const agentRevisionUpdate = vi.fn().mockResolvedValue({});
	const agentServiceUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
	const auditDecisionCreate = vi.fn().mockResolvedValue({});
	const transaction = {
		personaRevision: { findFirst: personaFindFirst, findMany: vi.fn().mockResolvedValue([{ id: "persona-old" }, { id: "persona-new" }]) },
		agentService: {
			findFirst: vi.fn().mockResolvedValue({ id: "service-1", activeRevisionId: options.activeRevisionId ?? source.id }),
			findMany: vi.fn().mockResolvedValue(options.services ?? [{ id: "service-1", activeRevisionId: source.id }]),
			updateMany: agentServiceUpdateMany,
		},
		agentRevision: { findFirst: agentRevisionFindFirst, create: agentRevisionCreate, update: agentRevisionUpdate },
		auditDecision: { create: auditDecisionCreate },
	} as unknown as Prisma.TransactionClient;
	return { transaction, personaFindFirst, agentRevisionCreate, agentRevisionUpdate, agentServiceUpdateMany, auditDecisionCreate };
}

/** Builds the exact-service command shared by the focused examples. */
function _Command()
{
	return {
		siloId: "silo-1",
		subjectId: "user-1",
		principalId: "principal-1",
		agentServiceId: "service-1",
		expectedSourceRevisionId: "agent-revision-1",
		targetPersonaRevisionId: "persona-new",
		authoredBy: "user-1",
		materializedAt: new Date("2026-08-17T09:00:00.000Z"),
		changeMessage: "Select approved persona revision persona-new",
	};
}

/** Creates an observable central-effect seam for persona-selection tests. */
function _ProductEffects()
{
	return {
		resolveCaller: vi.fn().mockResolvedValue({ siloId: "silo-1", subjectId: "user-1", principalId: "principal-1" }),
		reconcileCurrent: vi.fn().mockResolvedValue(undefined),
		admitInitialCreation: vi.fn().mockResolvedValue(undefined),
		admitInitialPublication: vi.fn().mockResolvedValue(undefined),
		admitRevisionSelection: vi.fn().mockResolvedValue(undefined),
		admitRevisionPublication: vi.fn().mockResolvedValue(undefined),
	};
}

describe("PrismaAgentRevisionPersonaSelectionRepository", function _PersonaSelectionSuite()
{
	it("copies every source field while changing only personaRevisionId", async function _CopiesOnlyPersonaSelection()
	{
		const fake = _Transaction();
		const productEffects = _ProductEffects();
		const repository = new PrismaAgentRevisionPersonaSelectionRepository(fake.transaction, productEffects);

		await expect(repository.materialize(_Command())).resolves.toEqual({ status: AgentRevisionPersonaSelectionMaterializationCodes.Materialized, agentRevisionId: "agent-revision-2", sourceRevisionId: "agent-revision-1" });
		expect(fake.agentRevisionCreate).toHaveBeenCalledWith({
			data: expect.objectContaining({
				revision: 8,
				parentRevision: { connect: { id: "agent-revision-1" } },
				personaRevisionId: "persona-new",
				modelDefinition: { connect: { id: "model-1" } },
				budget: { maxTurns: 64, maxTokens: 256_000, maxDurationMs: 3_600_000 },
				promptPolicyVersion: "prompt-v1",
			}),
			include: expect.any(Object),
		});
		expect(fake.agentRevisionUpdate).toHaveBeenCalledWith({ where: { id: "agent-revision-2" }, data: { state: "Published", publishedAt: _Command().materializedAt } });
		expect(fake.agentServiceUpdateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "service-1", activeRevisionId: "agent-revision-1" }), data: { activeRevisionId: "agent-revision-2", updatedAt: _Command().materializedAt } });
		expect(productEffects.admitRevisionSelection).toHaveBeenCalledWith(expect.objectContaining({ caller: expect.objectContaining({ principalId: "principal-1" }), source: expect.objectContaining({ agentServiceId: "service-1" }), target: expect.objectContaining({ personaProfileId: "profile-1", modelDefinitionId: "model-1" }) }));
		expect(productEffects.admitRevisionPublication).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ agentRevisionId: expect.any(String) }) }));
	});

	it("returns AlreadyCurrent without writing when the active revision already selects the target", async function _KeepsCurrentRevision()
	{
		const fake = _Transaction({ sourcePersonaId: "persona-new" });
		const repository = new PrismaAgentRevisionPersonaSelectionRepository(fake.transaction, _ProductEffects());

		await expect(repository.materialize(_Command())).resolves.toEqual({ status: AgentRevisionPersonaSelectionMaterializationCodes.AlreadyCurrent, agentRevisionId: "agent-revision-1", sourceRevisionId: "agent-revision-1" });
		expect(fake.agentRevisionCreate).not.toHaveBeenCalled();
		expect(fake.agentServiceUpdateMany).not.toHaveBeenCalled();
		expect(fake.auditDecisionCreate).not.toHaveBeenCalled();
	});

	it("returns StaleSource before writing when the active pointer moved", async function _RejectsStaleSource()
	{
		const fake = _Transaction({ activeRevisionId: "agent-revision-newer" });
		const repository = new PrismaAgentRevisionPersonaSelectionRepository(fake.transaction, _ProductEffects());

		await expect(repository.materialize(_Command())).resolves.toEqual({ status: AgentRevisionPersonaSelectionMaterializationCodes.StaleSource, sourceRevisionId: "agent-revision-1" });
		expect(fake.agentRevisionCreate).not.toHaveBeenCalled();
	});

	it("returns NotApplicable when persona approval finds no personal service", async function _AllowsOwnerWithoutAgent()
	{
		const fake = _Transaction({ services: [] });
		const repository = new PrismaAgentRevisionPersonaSelectionRepository(fake.transaction, _ProductEffects());

		await expect(repository.materializeForOwner({ siloId: "silo-1", subjectId: "user-1", targetPersonaRevisionId: "persona-new", authoredBy: "user-1", materializedAt: _Command().materializedAt, changeMessage: "Select approved persona revision persona-new" })).resolves.toEqual({ status: AgentRevisionPersonaSelectionMaterializationCodes.NotApplicable, sourceRevisionId: null });
		expect(fake.agentRevisionCreate).not.toHaveBeenCalled();
	});

	it("fails closed when more than one personal service matches the owner", async function _RejectsAmbiguousServices()
	{
		const fake = _Transaction({ services: [{ id: "service-1", activeRevisionId: "agent-revision-1" }, { id: "service-2", activeRevisionId: "agent-revision-2" }] });
		const repository = new PrismaAgentRevisionPersonaSelectionRepository(fake.transaction, _ProductEffects());

		await expect(repository.materializeForOwner({ siloId: "silo-1", subjectId: "user-1", targetPersonaRevisionId: "persona-new", authoredBy: "user-1", materializedAt: _Command().materializedAt, changeMessage: "Select approved persona revision persona-new" })).resolves.toEqual({ status: AgentRevisionPersonaSelectionMaterializationCodes.Unavailable, sourceRevisionId: "" });
		expect(fake.agentRevisionCreate).not.toHaveBeenCalled();
	});
});
