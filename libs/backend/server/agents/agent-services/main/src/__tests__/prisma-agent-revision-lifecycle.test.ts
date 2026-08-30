import { AgentServiceKind, AgentServiceState, PrincipalProvenance } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { MANAGED_AGENT_SERVICE_PRINCIPAL_ISSUER } from "../managed-agent-service-principal";
import { PrismaAgentRevisionLifecycleUnitOfWork } from "../db/prisma-agent-revision-lifecycle-unit-of-work";

describe("PrismaAgentRevisionLifecycleUnitOfWork", function _Suite()
{
	it("creates a durable internal Principal before linking a managed service", async function _CreatesPrincipal()
	{
		const principalCreate = vi.fn().mockResolvedValue({});
		const serviceCreate = vi.fn().mockImplementation(async function _Create(input) { return { ...input.data }; });
		const revisionCreate = vi.fn().mockImplementation(async function _Create(input)
		{
			return {
				id: "revision-1",
				agentServiceId: input.data.agentService.connect.id_siloId.id,
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
			authorizationGrant: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}), updateMany: vi.fn() },
			auditEntry: { create: vi.fn().mockResolvedValue({}) },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(callback) { return callback(transaction); }) };
		const repository = new PrismaAgentRevisionLifecycleUnitOfWork(prisma as never, function _Authorization()
		{
			return { admit: vi.fn().mockResolvedValue({ outcome: "allow" }), admitPrincipal: vi.fn().mockResolvedValue({ outcome: "allow" }), listPrincipalEntitled: vi.fn().mockResolvedValue([]) } as never;
		});

		const result = await repository.createManagedService({
			siloId: "silo-1",
			principalId: "principal-human",
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
		expect(transaction.modelDefinition.findUnique).toHaveBeenCalledWith({ where: { id_siloId: { id: "model-1", siloId: "silo-1" } }, select: { scope: true, clusterTenant: true } });
		expect(revisionCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ agentService: { connect: { id_siloId: { id: result.service.id, siloId: "silo-1" } } }, modelDefinition: { connect: { id_siloId: { id: "model-1", siloId: "silo-1" } } } }) }));
		expect(principalCreate.mock.invocationCallOrder[0]).toBeLessThan(serviceCreate.mock.invocationCallOrder[0]);
		expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
	});

	it("denies creation before persistence when current Organization administration is absent", async function _DeniesUnauthorizedCreate()
	{
		const transaction = { modelDefinition: { findUnique: vi.fn() }, principal: { create: vi.fn() }, agentService: { create: vi.fn() }, agentRevision: { create: vi.fn() } };
		const prisma = { $transaction: vi.fn(async function _Transaction(callback) { return callback(transaction); }) };
		const admitPrincipal = vi.fn().mockResolvedValue({ outcome: "deny" });
		const repository = new PrismaAgentRevisionLifecycleUnitOfWork(prisma as never, function _Authorization() { return { admit: vi.fn(), admitPrincipal, listPrincipalEntitled: vi.fn() } as never; });

		const result = await repository.createManagedService({
			siloId: "silo-1",
			principalId: "principal-human",
			name: "Research agent",
			workloadProfile: "managed",
			authoredBy: "principal-human",
			changeMessage: "Initial revision",
			content: { promptPolicyVersion: "prompt-v1", personaRevisionId: null, modelDefinitionId: "model-1", budget: { maxTurns: 5, maxTokens: 1_000, maxDurationMs: 30_000 }, skills: [], mcpToolRevisionIds: [], boundaryAttachments: [] },
		}, "2026-08-21T12:00:00.000Z");

		expect(result).toEqual({ outcome: "denied", reason: "unauthorized" });
		expect(admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ principalId: "principal-human", action: "administer", resource: { kind: "organization", id: "silo-1" } }));
		expect(transaction.agentService.create).not.toHaveBeenCalled();
	});
});
