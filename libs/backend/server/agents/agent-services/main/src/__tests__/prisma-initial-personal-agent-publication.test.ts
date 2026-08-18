import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { INITIAL_PERSONAL_AGENT_POLICY } from "../initial-personal-agent-policy";
import { InitialPersonalAgentDefaultModelResolutionStatuses, type InitialPersonalAgentDefaultModelResolver } from "../initial-personal-agent-publication.types";
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
		agentRevision: {
			create: vi.fn().mockResolvedValue({ id: "revision-a", digest: `sha256:${"a".repeat(64)}` }),
			update: vi.fn().mockResolvedValue({}),
		},
		auditDecision: { create: vi.fn().mockResolvedValue({ id: "audit-a" }) },
	};
}

/** Creates the app-owned model-routing adapter consumed by initial publication. */
function _DefaultModelResolver(status: InitialPersonalAgentDefaultModelResolutionStatuses = InitialPersonalAgentDefaultModelResolutionStatuses.Resolved): InitialPersonalAgentDefaultModelResolver
{
	return {
		async resolve()
		{
			if (status === InitialPersonalAgentDefaultModelResolutionStatuses.Resolved) return { status, modelDefinitionId: "configured-default" };
			if (status === InitialPersonalAgentDefaultModelResolutionStatuses.Ambiguous) return { status };
			return { status: InitialPersonalAgentDefaultModelResolutionStatuses.Unavailable };
		},
	};
}

/** Constructs the publisher without widening production code to a test-only client shape. */
function _Publisher(transaction: ReturnType<typeof _Transaction>, resolver: InitialPersonalAgentDefaultModelResolver = _DefaultModelResolver()): PrismaInitialPersonalAgentPublicationRepository
{
	return new PrismaInitialPersonalAgentPublicationRepository(transaction as unknown as Prisma.TransactionClient, resolver);
}

describe("Prisma initial personal-Agent publication", function _Suite()
{
	it("creates, publishes, activates, and audits the first revision", async function _Publishes()
	{
		const transaction = _Transaction();

		await expect(_Publisher(transaction).publish(_COMMAND, _PERSONA)).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Ready, agentServiceId: _COMMAND.onboardingId, agentRevisionId: "revision-a", created: true, revised: false });
		expect(transaction.agentService.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: _COMMAND.onboardingId, siloId: _COMMAND.siloId, kind: "Personal", state: "Draft", name: "The Commander", workloadProfile: "personal-default" }) });
		expect(transaction.agentRevision.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ revision: 1, promptPolicyVersion: INITIAL_PERSONAL_AGENT_POLICY.promptPolicyVersion, personaRevisionId: _COMMAND.onboardingPersonaRevisionId, budget: { maxTurns: 64, maxTokens: 256_000, maxDurationMs: 3_600_000 }, modelDefinition: { connect: { id: "configured-default" } } }),
			include: expect.any(Object),
		});
		expect(transaction.agentRevision.update).toHaveBeenCalledWith({ where: { id: "revision-a" }, data: { state: "Published", publishedAt: _COMMAND.provisionedAt } });
		expect(transaction.agentService.update).toHaveBeenCalledWith({ where: { id: _COMMAND.onboardingId }, data: { state: "Active", activeRevisionId: "revision-a", updatedAt: _COMMAND.provisionedAt } });
		expect(transaction.auditDecision.create).toHaveBeenCalledOnce();
	});

	it("fails closed without writes when model-routing reports no accessible definition", async function _UnavailableDefault()
	{
		const transaction = _Transaction();

		await expect(_Publisher(transaction, _DefaultModelResolver(InitialPersonalAgentDefaultModelResolutionStatuses.Unavailable)).publish(_COMMAND, _PERSONA)).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Denied, reason: PersonalAgentBootstrapDenialReasons.DefaultModelUnavailable });
		expect(transaction.agentService.create).not.toHaveBeenCalled();
		expect(transaction.agentRevision.create).not.toHaveBeenCalled();
		expect(transaction.auditDecision.create).not.toHaveBeenCalled();
	});

	it("fails closed without writes when model-routing reports ambiguous authority", async function _AmbiguousDefault()
	{
		const transaction = _Transaction();

		await expect(_Publisher(transaction, _DefaultModelResolver(InitialPersonalAgentDefaultModelResolutionStatuses.Ambiguous)).publish(_COMMAND, _PERSONA)).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Denied, reason: PersonalAgentBootstrapDenialReasons.DefaultModelAmbiguous });
		expect(transaction.agentService.create).not.toHaveBeenCalled();
		expect(transaction.agentRevision.create).not.toHaveBeenCalled();
		expect(transaction.auditDecision.create).not.toHaveBeenCalled();
	});

	it("propagates audit failure so the caller can roll back every write", async function _AuditFailure()
	{
		const transaction = _Transaction();
		transaction.auditDecision.create.mockRejectedValue(new Error("audit unavailable"));

		await expect(_Publisher(transaction).publish(_COMMAND, _PERSONA)).rejects.toThrow("audit unavailable");
	});
});
