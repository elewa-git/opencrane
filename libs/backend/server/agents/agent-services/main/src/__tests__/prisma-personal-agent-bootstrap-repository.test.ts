import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { INITIAL_PERSONAL_AGENT_POLICY } from "../initial-personal-agent-policy";
import { InitialPersonalAgentDefaultModelResolutionStatuses, type InitialPersonalAgentDefaultModelResolver } from "../initial-personal-agent-publication.types";
import { PersonalAgentBootstrapDenialReasons, PersonalAgentBootstrapStatuses, type PersonalAgentBootstrapCommand } from "../personal-agent-bootstrap.types";
import { PrismaPersonalAgentBootstrapRepository } from "../db/prisma-personal-agent-bootstrap-repository";

/** Trusted bootstrap command shared by focused repository tests. */
const _COMMAND: PersonalAgentBootstrapCommand = {
	onboardingId: "onboarding-a",
	siloId: "silo-a",
	subjectId: "subject-a",
	onboardingPersonaRevisionId: "persona-a",
	readinessKind: "completion",
	provisionedAt: new Date("2026-08-17T08:00:00.000Z"),
};

/** Approved subject-owned active persona returned by the authority database. */
function _Persona(activeRevisionId = _COMMAND.onboardingPersonaRevisionId)
{
	const approvedRevisionIds = activeRevisionId === _COMMAND.onboardingPersonaRevisionId ? [activeRevisionId] : [_COMMAND.onboardingPersonaRevisionId, activeRevisionId];
	return {
		state: "Approved",
		approvedAt: new Date("2026-08-17T07:00:00.000Z"),
		profile: {
			siloId: _COMMAND.siloId,
			userId: _COMMAND.subjectId,
			activeRevision: { id: activeRevisionId, state: "Approved", approvedAt: new Date("2026-08-17T07:30:00.000Z"), soulTemplate: { displayName: "The Commander" } },
			revisions: approvedRevisionIds.map(function _ApprovedRevision(id) { return { id }; }),
		},
	};
}

/** Creates a transaction-shaped test double for personal-agent bootstrap. */
function _Transaction()
{
	return {
		personaRevision: { findUnique: vi.fn().mockResolvedValue(_Persona()), findFirst: vi.fn() },
		agentService: {
			findMany: vi.fn().mockResolvedValue([]),
			findUnique: vi.fn().mockResolvedValue(null),
			findFirst: vi.fn(),
			create: vi.fn().mockResolvedValue({ id: _COMMAND.onboardingId, workloadProfile: INITIAL_PERSONAL_AGENT_POLICY.workloadProfile }),
			update: vi.fn().mockResolvedValue({}),
			updateMany: vi.fn().mockResolvedValue({ count: 1 }),
		},
		agentRevision: {
			findFirst: vi.fn(),
			create: vi.fn().mockResolvedValue({ id: "revision-a", digest: `sha256:${"a".repeat(64)}` }),
			update: vi.fn().mockResolvedValue({}),
		},
		auditDecision: { create: vi.fn().mockResolvedValue({ id: "audit-a" }) },
	};
}

/** Resolves the configured default for tests that reach initial publication. */
const _DEFAULT_MODEL_RESOLVER: InitialPersonalAgentDefaultModelResolver = {
	async resolve()
	{
		return { status: InitialPersonalAgentDefaultModelResolutionStatuses.Resolved, modelDefinitionId: "configured-default" };
	},
};

/** Constructs the repository without widening production code to a test-only client shape. */
function _Repository(transaction: ReturnType<typeof _Transaction>): PrismaPersonalAgentBootstrapRepository
{
	return new PrismaPersonalAgentBootstrapRepository(transaction as unknown as Prisma.TransactionClient, _DEFAULT_MODEL_RESOLVER);
}

describe("Prisma personal-agent bootstrap repository", function _Suite()
{
	it("rejects malformed evidence before consulting authority state", async function _InvalidCommand()
	{
		const transaction = _Transaction();

		await expect(_Repository(transaction).ensureReady({ ..._COMMAND, onboardingId: " " })).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Denied, reason: PersonalAgentBootstrapDenialReasons.InvalidCommand });
		expect(transaction.personaRevision.findUnique).not.toHaveBeenCalled();
	});

	it("returns the deterministic ready winner without duplicating writes", async function _IdempotentWinner()
	{
		const transaction = _Transaction();
		const existing = { id: _COMMAND.onboardingId, activeRevisionId: "revision-existing", workloadProfile: "personal-default", activeRevision: { personaRevisionId: _COMMAND.onboardingPersonaRevisionId } };
		transaction.agentService.findMany.mockResolvedValue([existing]);
		transaction.agentService.findUnique.mockResolvedValue({ ...existing, siloId: _COMMAND.siloId, kind: "Personal", state: "Active" });

		await expect(_Repository(transaction).ensureReady(_COMMAND)).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Ready, agentServiceId: _COMMAND.onboardingId, agentRevisionId: "revision-existing", created: false, revised: false });
		expect(transaction.agentService.create).not.toHaveBeenCalled();
		expect(transaction.agentRevision.create).not.toHaveBeenCalled();
		expect(transaction.auditDecision.create).not.toHaveBeenCalled();
	});

	it("adopts one earlier ready personal service when the deterministic identity is unused", async function _ExistingPersonalService()
	{
		const transaction = _Transaction();
		transaction.agentService.findMany.mockResolvedValue([{ id: "personal-existing", activeRevisionId: "revision-existing", workloadProfile: "personal-default", activeRevision: { personaRevisionId: _COMMAND.onboardingPersonaRevisionId } }]);

		await expect(_Repository(transaction).ensureReady(_COMMAND)).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Ready, agentServiceId: "personal-existing", agentRevisionId: "revision-existing", created: false, revised: false });
		expect(transaction.agentService.create).not.toHaveBeenCalled();
	});

	it("revises one existing service to the current persona without creating a second service", async function _RevisesExistingService()
	{
		const transaction = _Transaction();
		transaction.personaRevision.findUnique.mockResolvedValue(_Persona("persona-newer"));
		transaction.personaRevision.findFirst.mockResolvedValue({ personaProfileId: "profile-a" });
		transaction.agentService.findMany.mockResolvedValue([{ id: _COMMAND.onboardingId, activeRevisionId: "revision-existing", workloadProfile: "personal-default", activeRevision: { personaRevisionId: _COMMAND.onboardingPersonaRevisionId } }]);
		transaction.agentService.findUnique.mockResolvedValue({ id: _COMMAND.onboardingId, siloId: _COMMAND.siloId, kind: "Personal", state: "Active", activeRevisionId: "revision-existing", workloadProfile: "personal-default", activeRevision: { personaRevisionId: _COMMAND.onboardingPersonaRevisionId } });
		transaction.agentService.findFirst.mockResolvedValue({ id: _COMMAND.onboardingId, activeRevisionId: "revision-existing" });
		const source = { id: "revision-existing", agentServiceId: _COMMAND.onboardingId, revision: 1, state: "Published", personaRevisionId: _COMMAND.onboardingPersonaRevisionId, promptPolicyVersion: "prompt-v1", modelDefinitionId: "model-1", budget: INITIAL_PERSONAL_AGENT_POLICY.budget, skillAssignments: [], mcpToolAssignments: [], boundaryAttachments: [] };
		transaction.agentRevision.findFirst.mockResolvedValueOnce(source).mockResolvedValueOnce({ id: "revision-existing" });
		transaction.agentRevision.create.mockResolvedValue({ ...source, id: "revision-new", revision: 2, personaRevisionId: "persona-newer", digest: `sha256:${"b".repeat(64)}` });

		await expect(_Repository(transaction).ensureReady({ ..._COMMAND, readinessKind: "repair" })).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Ready, agentServiceId: _COMMAND.onboardingId, agentRevisionId: "revision-new", created: false, revised: true });
		expect(transaction.agentService.create).not.toHaveBeenCalled();
		expect(transaction.agentService.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: _COMMAND.onboardingId, activeRevisionId: "revision-existing" }), data: expect.objectContaining({ activeRevisionId: "revision-new" }) }));
	});

	it("fails closed when more than one ready service matches the persona", async function _AmbiguousService()
	{
		const transaction = _Transaction();
		transaction.agentService.findMany.mockResolvedValue([
			{ id: "personal-a", activeRevisionId: "revision-a", workloadProfile: "personal-default", activeRevision: { personaRevisionId: _COMMAND.onboardingPersonaRevisionId } },
			{ id: "personal-b", activeRevisionId: "revision-b", workloadProfile: "personal-default", activeRevision: { personaRevisionId: _COMMAND.onboardingPersonaRevisionId } },
		]);

		await expect(_Repository(transaction).ensureReady(_COMMAND)).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Denied, reason: PersonalAgentBootstrapDenialReasons.ServiceAmbiguous });
		expect(transaction.agentService.create).not.toHaveBeenCalled();
	});

	it("uses the current approved persona when a completed user is repaired after refresh", async function _RefreshedPersona()
	{
		const transaction = _Transaction();
		transaction.personaRevision.findUnique.mockResolvedValue(_Persona("persona-newer"));

		await expect(_Repository(transaction).ensureReady({ ..._COMMAND, readinessKind: "repair" })).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Ready, agentServiceId: _COMMAND.onboardingId, agentRevisionId: "revision-a", created: true, revised: false });
		expect(transaction.agentRevision.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ personaRevisionId: "persona-newer" }) }));
	});

	it("rejects a persona refresh racing the initial onboarding conclusion", async function _ConcurrentRefresh()
	{
		const transaction = _Transaction();
		transaction.personaRevision.findUnique.mockResolvedValue(_Persona("persona-newer"));

		await expect(_Repository(transaction).ensureReady(_COMMAND)).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Denied, reason: PersonalAgentBootstrapDenialReasons.PersonaNotActive });
		expect(transaction.agentService.findMany).not.toHaveBeenCalled();
	});

	it("rejects an unrelated service holding the deterministic onboarding identity", async function _IdentityConflict()
	{
		const transaction = _Transaction();
		transaction.agentService.findUnique.mockResolvedValue({ id: _COMMAND.onboardingId, siloId: "other-silo", kind: "Managed", state: "Active", activeRevisionId: "revision-other", workloadProfile: "managed-default", activeRevision: { personaRevisionId: "persona-other" } });

		await expect(_Repository(transaction).ensureReady(_COMMAND)).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Denied, reason: PersonalAgentBootstrapDenialReasons.ServiceIdentityConflict });
		expect(transaction.agentService.create).not.toHaveBeenCalled();
	});

});
