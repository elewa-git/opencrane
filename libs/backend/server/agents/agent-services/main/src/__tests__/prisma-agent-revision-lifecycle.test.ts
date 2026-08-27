import { AgentServiceKind, AgentServiceState, PrincipalProvenance } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { MANAGED_AGENT_SERVICE_PRINCIPAL_ISSUER } from "../managed-agent-service-principal";
import { PrismaAgentRevisionLifecycleRepository } from "../db/prisma-agent-revision-lifecycle";

describe("PrismaAgentRevisionLifecycleRepository", function _Suite()
{
	it("creates a durable internal Principal before linking a managed service", async function _CreatesPrincipal()
	{
		const principalCreate = vi.fn().mockResolvedValue({});
		const serviceCreate = vi.fn().mockImplementation(async function _Create(input) { return { ...input.data }; });
		const revisionCreate = vi.fn().mockImplementation(async function _Create(input)
		{
			return {
				id: "revision-1",
				agentServiceId: input.data.agentService.connect.id,
				revision: 1,
				parentRevisionId: null,
				sourceRevisionId: null,
				changeMessage: input.data.changeMessage,
				state: "Draft",
				digest: input.data.digest,
				promptPolicyVersion: "prompt-v1",
				personaRevisionId: null,
				modelDefinitionId: "model-1",
				budget: input.data.budget,
				authoredBy: "principal-human",
				createdAt: input.data.createdAt,
				publishedAt: null,
				skillAssignments: [],
				mcpToolAssignments: [],
				boundaryAttachments: [],
			};
		});
		const transaction = {
			modelDefinition: { findUnique: vi.fn().mockResolvedValue({ scope: "Global", clusterTenant: null }) },
			principal: { create: principalCreate },
			agentService: { create: serviceCreate },
			agentRevision: { create: revisionCreate },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(callback) { return callback(transaction); }) };
		const repository = new PrismaAgentRevisionLifecycleRepository(prisma as never);

		const result = await repository.createManagedService({
			siloId: "silo-1",
			name: "Research agent",
			workloadProfile: "managed",
			authoredBy: "principal-human",
			changeMessage: "Initial revision",
			content: { promptPolicyVersion: "prompt-v1", personaRevisionId: null, modelDefinitionId: "model-1", budget: { maxTurns: 5, maxTokens: 1_000, maxDurationMs: 30_000 }, skills: [], mcpToolRevisionIds: [], boundaryAttachments: [] },
		}, "2026-08-21T12:00:00.000Z");

		expect(result.outcome).toBe("created");
		if (result.outcome !== "created")
			throw new Error("expected managed service creation");
		const expectedPrincipalId = `agent-service:${result.service.id}`;
		expect(principalCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ id: expectedPrincipalId, siloId: "silo-1", issuer: MANAGED_AGENT_SERVICE_PRINCIPAL_ISSUER, subject: result.service.id, provenance: PrincipalProvenance.Internal }) });
		expect(serviceCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ id: result.service.id, principalId: expectedPrincipalId, kind: AgentServiceKind.Managed, state: AgentServiceState.Draft }) });
		expect(principalCreate.mock.invocationCallOrder[0]).toBeLessThan(serviceCreate.mock.invocationCallOrder[0]);
	});
});
