import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { INITIAL_PERSONAL_AGENT_POLICY } from "../initial-personal-agent-policy";
import { InitialPersonalAgentDefaultModelResolutionStatuses, type InitialPersonalAgentDefaultModelResolver } from "../initial-personal-agent-publication.types";
import { PersonalAgentBootstrapDenialReasons, PersonalAgentBootstrapStatuses, type PersonalAgentBootstrapCommand } from "../personal-agent-bootstrap.types";
import { PrismaInitialPersonalAgentPublicationRepository } from "../db/prisma-initial-personal-agent-publication";

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
const _PERSONA = { profileId: "profile-a", id: _COMMAND.onboardingPersonaRevisionId, displayName: "The Commander" };

/** Local Principal resolved from the trusted onboarding subject. */
const _CALLER = { siloId: _COMMAND.siloId, subjectId: _COMMAND.subjectId, principalId: "principal-a" };

/** Creates an observable product-effect adapter without reproducing central policy in this test. */
function _ProductEffects()
{
	return {
		resolveCaller: vi.fn().mockResolvedValue(_CALLER),
		reconcileCurrent: vi.fn().mockResolvedValue(undefined),
		admitInitialCreation: vi.fn().mockResolvedValue(undefined),
		admitInitialPublication: vi.fn().mockResolvedValue(undefined),
		admitRevisionSelection: vi.fn().mockResolvedValue(undefined),
		admitRevisionPublication: vi.fn().mockResolvedValue(undefined),
	};
}

/** Creates a transaction-shaped test double for initial personal-Agent publication. */
function _Transaction()
{
	return {
		modelDefinition: { findUnique: vi.fn().mockResolvedValue({ id: "configured-default" }) },
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
			if (status === InitialPersonalAgentDefaultModelResolutionStatuses.Resolved)
				return { status, modelDefinitionId: "configured-default" };
			if (status === InitialPersonalAgentDefaultModelResolutionStatuses.Ambiguous)
				return { status };
			return { status: InitialPersonalAgentDefaultModelResolutionStatuses.Unavailable };
		},
	};
}

/** Constructs the publisher without widening production code to a test-only client shape. */
function _Publisher(transaction: ReturnType<typeof _Transaction>, resolver: InitialPersonalAgentDefaultModelResolver = _DefaultModelResolver(), productEffects: ReturnType<typeof _ProductEffects> = _ProductEffects()): PrismaInitialPersonalAgentPublicationRepository
{
	return new PrismaInitialPersonalAgentPublicationRepository(transaction as unknown as Prisma.TransactionClient, resolver, productEffects);
}

describe("Prisma initial personal-Agent publication", function _Suite()
{
	it("creates, publishes, activates, and audits the first revision", async function _Publishes()
	{
		const transaction = _Transaction();
		const productEffects = _ProductEffects();

		await expect(_Publisher(transaction, _DefaultModelResolver(), productEffects).publish(_COMMAND, _PERSONA, _CALLER)).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Ready, agentServiceId: _COMMAND.onboardingId, agentRevisionId: "revision-a", created: true, revised: false });
		expect(productEffects.admitInitialCreation).toHaveBeenCalledWith(expect.objectContaining({ caller: _CALLER, agentServiceId: _COMMAND.onboardingId }));
		expect(productEffects.admitInitialPublication).toHaveBeenCalledWith(expect.objectContaining({ caller: _CALLER, agentServiceId: _COMMAND.onboardingId, personaProfileId: _PERSONA.profileId, modelDefinitionId: "configured-default" }));
		expect(productEffects.admitInitialCreation.mock.invocationCallOrder[0]).toBeLessThan(transaction.agentService.create.mock.invocationCallOrder[0] ?? 0);
		expect(productEffects.admitInitialPublication.mock.invocationCallOrder[0]).toBeGreaterThan(transaction.agentRevision.create.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER);
		expect(transaction.agentService.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: _COMMAND.onboardingId, siloId: _COMMAND.siloId, kind: "Personal", state: "Draft", name: "The Commander", workloadProfile: "personal-default" }) });
		expect(transaction.agentRevision.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ revision: 1, promptPolicyVersion: INITIAL_PERSONAL_AGENT_POLICY.promptPolicyVersion, personaRevisionId: _COMMAND.onboardingPersonaRevisionId, budget: { maxTurns: 64, maxTokens: 256_000, maxDurationMs: 3_600_000 }, modelDefinition: { connect: { id_siloId: { id: "configured-default", siloId: _COMMAND.siloId } } } }),
			include: expect.any(Object),
		});
		expect(transaction.agentRevision.update).toHaveBeenCalledWith({ where: { id_siloId: { id: "revision-a", siloId: _COMMAND.siloId } }, data: { state: "Published", publishedAt: _COMMAND.provisionedAt } });
		expect(transaction.agentService.update).toHaveBeenCalledWith({ where: { id_siloId: { id: _COMMAND.onboardingId, siloId: _COMMAND.siloId } }, data: { state: "Active", activeRevisionId: "revision-a", updatedAt: _COMMAND.provisionedAt } });
	});

	it("fails closed before admission when the resolved default is not in the bootstrap silo", async function _RejectsForeignDefault()
	{
		const transaction = _Transaction();
		transaction.modelDefinition.findUnique.mockResolvedValue(null);
		const productEffects = _ProductEffects();

		await expect(_Publisher(transaction, _DefaultModelResolver(), productEffects).publish(_COMMAND, _PERSONA, _CALLER)).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Denied, reason: PersonalAgentBootstrapDenialReasons.DefaultModelUnavailable });
		expect(transaction.modelDefinition.findUnique).toHaveBeenCalledWith({ where: { id_siloId: { id: "configured-default", siloId: _COMMAND.siloId } }, select: { id: true } });
		expect(productEffects.admitInitialCreation).not.toHaveBeenCalled();
		expect(transaction.agentService.create).not.toHaveBeenCalled();
	});

	it("fails closed without writes when model-routing reports no accessible definition", async function _UnavailableDefault()
	{
		const transaction = _Transaction();

		await expect(_Publisher(transaction, _DefaultModelResolver(InitialPersonalAgentDefaultModelResolutionStatuses.Unavailable)).publish(_COMMAND, _PERSONA, _CALLER)).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Denied, reason: PersonalAgentBootstrapDenialReasons.DefaultModelUnavailable });
		expect(transaction.agentService.create).not.toHaveBeenCalled();
		expect(transaction.agentRevision.create).not.toHaveBeenCalled();
		expect(transaction.auditDecision.create).not.toHaveBeenCalled();
	});

	it("fails closed without writes when model-routing reports ambiguous authority", async function _AmbiguousDefault()
	{
		const transaction = _Transaction();

		await expect(_Publisher(transaction, _DefaultModelResolver(InitialPersonalAgentDefaultModelResolutionStatuses.Ambiguous)).publish(_COMMAND, _PERSONA, _CALLER)).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Denied, reason: PersonalAgentBootstrapDenialReasons.DefaultModelAmbiguous });
		expect(transaction.agentService.create).not.toHaveBeenCalled();
		expect(transaction.agentRevision.create).not.toHaveBeenCalled();
		expect(transaction.auditDecision.create).not.toHaveBeenCalled();
	});

	it("propagates collection-root denial before protected writes", async function _AdmissionFailure()
	{
		const transaction = _Transaction();
		const productEffects = _ProductEffects();
		productEffects.admitInitialCreation.mockRejectedValue(new Error("authorization unavailable"));

		await expect(_Publisher(transaction, _DefaultModelResolver(), productEffects).publish(_COMMAND, _PERSONA, _CALLER)).rejects.toThrow("authorization unavailable");
		expect(transaction.agentService.create).not.toHaveBeenCalled();
	});
});
