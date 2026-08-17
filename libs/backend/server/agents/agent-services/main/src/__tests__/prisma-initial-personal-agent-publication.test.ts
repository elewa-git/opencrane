import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { INITIAL_PERSONAL_AGENT_POLICY } from "../initial-personal-agent-policy";
import { PersonalAgentBootstrapDenialReasons, PersonalAgentBootstrapStatuses, type PersonalAgentBootstrapCommand } from "../personal-agent-bootstrap.types";
import { PrismaInitialPersonalAgentPublicationRepository } from "../prisma-initial-personal-agent-publication";

/** Trusted bootstrap command shared by focused publication tests. */
const _COMMAND: PersonalAgentBootstrapCommand = {
	onboardingId: "onboarding-a",
	siloId: "silo-a",
	subjectId: "subject-a",
	onboardingPersonaRevisionId: "persona-a",
	readinessKind: "completion",
	provisionedAt: new Date("2026-08-17T08:00:00.000Z"),
};

/** Approved persona selected by the bootstrap repository. */
const _PERSONA = { id: _COMMAND.onboardingPersonaRevisionId, displayName: "The Commander" };

/** Creates a transaction-shaped test double for initial personal-Agent publication. */
function _Transaction()
{
	return {
		agentService: {
			create: vi.fn().mockResolvedValue({ id: _COMMAND.onboardingId, workloadProfile: INITIAL_PERSONAL_AGENT_POLICY.workloadProfile }),
			update: vi.fn().mockResolvedValue({}),
		},
		modelDefinition: { findMany: vi.fn().mockResolvedValueOnce([{ id: "tenant-default" }]) },
		agentRevision: {
			create: vi.fn().mockResolvedValue({ id: "revision-a", digest: `sha256:${"a".repeat(64)}` }),
			update: vi.fn().mockResolvedValue({}),
		},
		auditDecision: { create: vi.fn().mockResolvedValue({ id: "audit-a" }) },
	};
}

/** Constructs the publisher without widening production code to a test-only client shape. */
function _Publisher(transaction: ReturnType<typeof _Transaction>): PrismaInitialPersonalAgentPublicationRepository
{
	return new PrismaInitialPersonalAgentPublicationRepository(transaction as unknown as Prisma.TransactionClient);
}

describe("Prisma initial personal-Agent publication", function _Suite()
{
	it("creates, publishes, activates, and audits the first revision", async function _Publishes()
	{
		const transaction = _Transaction();

		await expect(_Publisher(transaction).publish(_COMMAND, _PERSONA)).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Ready, agentServiceId: _COMMAND.onboardingId, agentRevisionId: "revision-a", created: true, revised: false });
		expect(transaction.agentService.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: _COMMAND.onboardingId, siloId: _COMMAND.siloId, kind: "Personal", state: "Draft", name: "The Commander", workloadProfile: "personal-default" }) });
		expect(transaction.agentRevision.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ revision: 1, promptPolicyVersion: INITIAL_PERSONAL_AGENT_POLICY.promptPolicyVersion, personaRevisionId: _COMMAND.onboardingPersonaRevisionId, budget: { maxTurns: 64, maxTokens: 256_000, maxDurationMs: 3_600_000 }, modelDefinition: { connect: { id: "tenant-default" } } }),
			include: expect.any(Object),
		});
		expect(transaction.agentRevision.update).toHaveBeenCalledWith({ where: { id: "revision-a" }, data: { state: "Published", publishedAt: _COMMAND.provisionedAt } });
		expect(transaction.agentService.update).toHaveBeenCalledWith({ where: { id: _COMMAND.onboardingId }, data: { state: "Active", activeRevisionId: "revision-a", updatedAt: _COMMAND.provisionedAt } });
		expect(transaction.auditDecision.create).toHaveBeenCalledOnce();
	});

	it("prefers one tenant default without consulting the global fallback", async function _TenantDefaultWins()
	{
		const transaction = _Transaction();

		await _Publisher(transaction).publish(_COMMAND, _PERSONA);
		expect(transaction.modelDefinition.findMany).toHaveBeenCalledOnce();
		expect(transaction.modelDefinition.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { scope: "ClusterTenant", clusterTenant: _COMMAND.siloId, isDefault: true } }));
	});

	it("uses one global default when the silo has no default", async function _GlobalFallback()
	{
		const transaction = _Transaction();
		transaction.modelDefinition.findMany.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "global-default" }]);

		await expect(_Publisher(transaction).publish(_COMMAND, _PERSONA)).resolves.toMatchObject({ status: PersonalAgentBootstrapStatuses.Ready });
		expect(transaction.agentRevision.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ modelDefinition: { connect: { id: "global-default" } } }) }));
	});

	it("fails closed when the selected model scope is ambiguous", async function _AmbiguousDefault()
	{
		const transaction = _Transaction();
		transaction.modelDefinition.findMany.mockReset().mockResolvedValueOnce([{ id: "model-a" }, { id: "model-b" }]);

		await expect(_Publisher(transaction).publish(_COMMAND, _PERSONA)).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Denied, reason: PersonalAgentBootstrapDenialReasons.DefaultModelAmbiguous });
		expect(transaction.agentService.create).not.toHaveBeenCalled();
	});

	it("fails closed when neither model scope has a default", async function _MissingDefault()
	{
		const transaction = _Transaction();
		transaction.modelDefinition.findMany.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([]);

		await expect(_Publisher(transaction).publish(_COMMAND, _PERSONA)).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Denied, reason: PersonalAgentBootstrapDenialReasons.DefaultModelUnavailable });
		expect(transaction.agentService.create).not.toHaveBeenCalled();
	});

	it("propagates audit failure so the caller can roll back every write", async function _AuditFailure()
	{
		const transaction = _Transaction();
		transaction.auditDecision.create.mockRejectedValue(new Error("audit unavailable"));

		await expect(_Publisher(transaction).publish(_COMMAND, _PERSONA)).rejects.toThrow("audit unavailable");
	});
});
