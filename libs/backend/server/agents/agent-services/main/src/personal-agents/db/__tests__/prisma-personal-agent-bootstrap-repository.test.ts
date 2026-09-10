import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { INITIAL_PERSONAL_AGENT_POLICY } from "../../initial-personal-agent-policy";
import { InitialPersonalAgentDefaultModelResolutionStatuses, type InitialPersonalAgentDefaultModelResolver } from "../../initial-personal-agent-publication.types";
import { PersonalAgentBootstrapDenialReasons, PersonalAgentBootstrapStatuses, type PersonalAgentBootstrapCommand } from "../../personal-agent-bootstrap.types";
import { PrismaPersonalAgentBootstrapRepository } from "../prisma-personal-agent-bootstrap-repository";

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
			id: "profile-a",
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
		modelDefinition: { findUnique: vi.fn().mockResolvedValue({ id: "configured-default" }) },
		personaRevision: { findUnique: vi.fn().mockResolvedValue(_Persona()), findFirst: vi.fn() },
		agentService: {
			findMany: vi.fn().mockResolvedValue([]),
			findUnique: vi.fn().mockResolvedValue(null),
			findFirst: vi.fn(),
			create: vi.fn().mockResolvedValue({ id: _COMMAND.onboardingId, workloadProfile: "developer" }),
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

/** Creates a deterministic active service whose profile can be changed by the repair CAS. */
function _RepairTransaction()
{
	const transaction = _Transaction();
	const service = {
		id: _COMMAND.onboardingId,
		siloId: _COMMAND.siloId,
		kind: "Personal",
		state: "Active",
		activeRevisionId: "revision-existing",
		workloadProfile: "legacy-profile",
		activeRevision: { personaRevisionId: _COMMAND.onboardingPersonaRevisionId, modelDefinitionId: "model-1" },
	};
	transaction.agentService.findMany.mockImplementation(async function _ReadMatchingServices() { return [service]; });
	transaction.agentService.findUnique.mockImplementation(async function _ReadDeterministicService() { return service; });
	transaction.agentService.findFirst.mockResolvedValue({ id: service.id, activeRevisionId: service.activeRevisionId, workloadProfile: service.workloadProfile, conversations: [], runs: [] });
	transaction.agentService.updateMany.mockImplementation(async function _RepairProfile() { service.workloadProfile = "developer"; return { count: 1 }; });
	return { transaction, service };
}

/** Resolves the configured default for tests that reach initial publication. */
const _DEFAULT_MODEL_RESOLVER: InitialPersonalAgentDefaultModelResolver = {
	async resolve()
	{
		return { status: InitialPersonalAgentDefaultModelResolutionStatuses.Resolved, modelDefinitionId: "configured-default" };
	},
};

/** Creates a central-effect test seam that resolves the trusted owner without policy duplication. */
function _ProductEffects()
{
	return {
		resolveCaller: vi.fn().mockResolvedValue({ siloId: _COMMAND.siloId, subjectId: _COMMAND.subjectId, principalId: "principal-a" }),
		reconcileCurrent: vi.fn().mockResolvedValue(undefined),
		admitInitialCreation: vi.fn().mockResolvedValue(undefined),
		admitInitialPublication: vi.fn().mockResolvedValue(undefined),
		admitRevisionSelection: vi.fn().mockResolvedValue(undefined),
		admitRevisionPublication: vi.fn().mockResolvedValue(undefined),
		admitUnusedProfileChange: vi.fn().mockResolvedValue(undefined),
	};
}

/** Constructs the repository without widening production code to a test-only client shape. */
function _Repository(transaction: ReturnType<typeof _Transaction>, productEffects: ReturnType<typeof _ProductEffects> = _ProductEffects(), configuredWorkloadProfiles: readonly string[] = ["developer"]): PrismaPersonalAgentBootstrapRepository
{
	return new PrismaPersonalAgentBootstrapRepository(transaction as unknown as Prisma.TransactionClient, _DEFAULT_MODEL_RESOLVER, "developer", configuredWorkloadProfiles, productEffects);
}

describe("Prisma personal-agent bootstrap repository", function _Suite()
{
	it.each(["", " ", " developer"])("rejects unusable configured profile %j before any authority read", function _InvalidProfile(profile)
	{
		const transaction = _Transaction();
		expect(function _Construct() { return new PrismaPersonalAgentBootstrapRepository(transaction as never, _DEFAULT_MODEL_RESOLVER, profile, ["developer"], _ProductEffects()); }).toThrow("configured workload profile");
		expect(transaction.personaRevision.findUnique).not.toHaveBeenCalled();
	});

	it.each([{ configuredWorkloadProfiles: [] }, { configuredWorkloadProfiles: [""] }, { configuredWorkloadProfiles: ["developer", "developer"] }])("rejects malformed configured profile registry %j before any authority read", function _InvalidProfileRegistry({ configuredWorkloadProfiles }: { readonly configuredWorkloadProfiles: readonly string[] })
	{
		const transaction = _Transaction();
		expect(function _Construct() { return new PrismaPersonalAgentBootstrapRepository(transaction as never, _DEFAULT_MODEL_RESOLVER, "developer", configuredWorkloadProfiles, _ProductEffects()); }).toThrow("configured workload profile");
		expect(transaction.personaRevision.findUnique).not.toHaveBeenCalled();
	});

	it.each([true, false])("rejects an existing mismatched profile without rewriting it (deterministic: %s)", async function _RejectsProfileMismatch(deterministic)
	{
		const transaction = _Transaction();
		const id = deterministic ? _COMMAND.onboardingId : "earlier-personal";
		const existing = { id, activeRevisionId: "revision-existing", workloadProfile: "personal-default", activeRevision: { personaRevisionId: _COMMAND.onboardingPersonaRevisionId, modelDefinitionId: "model-1" } };
		transaction.agentService.findMany.mockResolvedValue([existing]);
		if (deterministic)
			transaction.agentService.findUnique.mockResolvedValue({ ...existing, siloId: _COMMAND.siloId, kind: "Personal", state: "Active" });
		await expect(_Repository(transaction).ensureReady(_COMMAND)).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Denied, reason: PersonalAgentBootstrapDenialReasons.ServiceNotReady });
		expect(transaction.agentService.create).not.toHaveBeenCalled();
		expect(transaction.agentService.update).not.toHaveBeenCalled();
		expect(transaction.agentService.updateMany).not.toHaveBeenCalled();
		expect(transaction.agentRevision.create).not.toHaveBeenCalled();
	});

	it("rejects malformed evidence before consulting authority state", async function _InvalidCommand()
	{
		const transaction = _Transaction();

		await expect(_Repository(transaction).ensureReady({ ..._COMMAND, onboardingId: " " })).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Denied, reason: PersonalAgentBootstrapDenialReasons.InvalidCommand });
		expect(transaction.personaRevision.findUnique).not.toHaveBeenCalled();
	});

	it("returns the deterministic ready winner without duplicating writes", async function _IdempotentWinner()
	{
		const transaction = _Transaction();
		const existing = { id: _COMMAND.onboardingId, activeRevisionId: "revision-existing", workloadProfile: "developer", activeRevision: { personaRevisionId: _COMMAND.onboardingPersonaRevisionId, modelDefinitionId: "model-1" } };
		transaction.agentService.findMany.mockResolvedValue([existing]);
		transaction.agentService.findUnique.mockResolvedValue({ ...existing, siloId: _COMMAND.siloId, kind: "Personal", state: "Active" });

		await expect(_Repository(transaction).ensureReady(_COMMAND)).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Ready, agentServiceId: _COMMAND.onboardingId, agentRevisionId: "revision-existing", created: false, revised: false });
		expect(transaction.agentService.create).not.toHaveBeenCalled();
		expect(transaction.agentRevision.create).not.toHaveBeenCalled();
		expect(transaction.auditDecision.create).not.toHaveBeenCalled();
	});

	it("repairs an unused deterministic service in place while preserving identity and revision", async function _RepairsUnusedService()
	{
		const fake = _RepairTransaction();
		const productEffects = _ProductEffects();

		await expect(_Repository(fake.transaction, productEffects).ensureReady({ ..._COMMAND, readinessKind: "repair" })).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Ready, agentServiceId: _COMMAND.onboardingId, agentRevisionId: "revision-existing", created: false, revised: false });
		expect(productEffects.admitUnusedProfileChange).toHaveBeenCalledWith({ caller: { siloId: _COMMAND.siloId, subjectId: _COMMAND.subjectId, principalId: "principal-a" }, onboardingId: _COMMAND.onboardingId, agentServiceId: _COMMAND.onboardingId, agentRevisionId: "revision-existing", sourceWorkloadProfile: "legacy-profile", targetWorkloadProfile: "developer", now: _COMMAND.provisionedAt });
		expect(fake.transaction.agentService.updateMany).toHaveBeenCalledWith({ where: { id: _COMMAND.onboardingId, siloId: _COMMAND.siloId, kind: "Personal", state: "Active", activeRevisionId: "revision-existing", workloadProfile: "legacy-profile", conversations: { none: {} }, runs: { none: {} } }, data: { workloadProfile: "developer", updatedAt: _COMMAND.provisionedAt } });
		expect(productEffects.admitUnusedProfileChange.mock.invocationCallOrder[0]).toBeLessThan(fake.transaction.agentService.updateMany.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER);
		expect(fake.transaction.agentRevision.create).not.toHaveBeenCalled();
		expect(fake.transaction.agentRevision.update).not.toHaveBeenCalled();
		expect(fake.transaction.auditDecision.create).not.toHaveBeenCalled();
	});

	it("rejects a repair when the old profile remains in the complete configured registry", async function _RejectsRetainedProfile()
	{
		const fake = _RepairTransaction();
		const productEffects = _ProductEffects();

		await expect(_Repository(fake.transaction, productEffects, ["legacy-profile", "developer"]).ensureReady({ ..._COMMAND, readinessKind: "repair" })).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Denied, reason: PersonalAgentBootstrapDenialReasons.ServiceNotReady });
		expect(productEffects.admitUnusedProfileChange).not.toHaveBeenCalled();
		expect(fake.transaction.agentService.updateMany).not.toHaveBeenCalled();
	});

	it("makes a profile repair replay idempotent without a second authority decision", async function _ReplaysRepair()
	{
		const fake = _RepairTransaction();
		const productEffects = _ProductEffects();
		const repository = _Repository(fake.transaction, productEffects);

		await expect(repository.ensureReady({ ..._COMMAND, readinessKind: "repair" })).resolves.toMatchObject({ status: PersonalAgentBootstrapStatuses.Ready, agentServiceId: _COMMAND.onboardingId, agentRevisionId: "revision-existing" });
		await expect(repository.ensureReady({ ..._COMMAND, readinessKind: "repair" })).resolves.toMatchObject({ status: PersonalAgentBootstrapStatuses.Ready, agentServiceId: _COMMAND.onboardingId, agentRevisionId: "revision-existing" });
		expect(productEffects.admitUnusedProfileChange).toHaveBeenCalledOnce();
		expect(fake.transaction.agentService.updateMany).toHaveBeenCalledOnce();
		expect(fake.transaction.agentRevision.create).not.toHaveBeenCalled();
	});

	it("rejects a completed onboarding mismatch and a repair on a non-deterministic service", async function _RejectsNonRepairableProfiles()
	{
		const completed = _Transaction();
		const completedService = { id: _COMMAND.onboardingId, activeRevisionId: "revision-existing", workloadProfile: "legacy-profile", activeRevision: { personaRevisionId: _COMMAND.onboardingPersonaRevisionId, modelDefinitionId: "model-1" } };
		completed.agentService.findMany.mockResolvedValue([completedService]);
		completed.agentService.findUnique.mockResolvedValue({ ...completedService, siloId: _COMMAND.siloId, kind: "Personal", state: "Active" });
		await expect(_Repository(completed).ensureReady(_COMMAND)).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Denied, reason: PersonalAgentBootstrapDenialReasons.ServiceNotReady });
		expect(completed.agentService.updateMany).not.toHaveBeenCalled();

		const nonDeterministic = _Transaction();
		nonDeterministic.agentService.findMany.mockResolvedValue([completedService]);
		await expect(_Repository(nonDeterministic).ensureReady({ ..._COMMAND, readinessKind: "repair" })).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Denied, reason: PersonalAgentBootstrapDenialReasons.ServiceNotReady });
		expect(nonDeterministic.agentService.updateMany).not.toHaveBeenCalled();
	});

	it.each([
		{ label: "used", findFirstResult: null },
		{ label: "stale source", findFirstResult: null },
	])("rejects a $label deterministic repair before central admission", async function _RejectsUsedOrStale({ label, findFirstResult })
	{
		const fake = _RepairTransaction();
		const productEffects = _ProductEffects();
		fake.transaction.agentService.findFirst.mockResolvedValue(findFirstResult);

		await expect(_Repository(fake.transaction, productEffects).ensureReady({ ..._COMMAND, readinessKind: "repair" })).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Denied, reason: PersonalAgentBootstrapDenialReasons.ServiceNotReady });
		expect(productEffects.admitUnusedProfileChange).not.toHaveBeenCalled();
		expect(fake.transaction.agentService.updateMany).not.toHaveBeenCalled();
		if (label === "used")
			expect(fake.transaction.agentService.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ conversations: { none: {} }, runs: { none: {} } }) }));
	});

	it("propagates a denied profile-effect decision before changing the service", async function _RejectsAuthorization()
	{
		const fake = _RepairTransaction();
		const productEffects = _ProductEffects();
		productEffects.admitUnusedProfileChange.mockRejectedValue(new Error("authorization unavailable"));

		await expect(_Repository(fake.transaction, productEffects).ensureReady({ ..._COMMAND, readinessKind: "repair" })).rejects.toThrow("authorization unavailable");
		expect(fake.transaction.agentService.updateMany).not.toHaveBeenCalled();
	});

	it("fails the repair when the service compare-and-swap loses its source", async function _RejectsCasLoss()
	{
		const fake = _RepairTransaction();
		fake.transaction.agentService.updateMany.mockResolvedValue({ count: 0 });

		await expect(_Repository(fake.transaction).ensureReady({ ..._COMMAND, readinessKind: "repair" })).rejects.toThrow("lost its source comparison");
		expect(fake.transaction.agentService.updateMany).toHaveBeenCalledOnce();
	});

	it("adopts one earlier ready personal service when the deterministic identity is unused", async function _ExistingPersonalService()
	{
		const transaction = _Transaction();
		transaction.agentService.findMany.mockResolvedValue([{ id: "personal-existing", activeRevisionId: "revision-existing", workloadProfile: "developer", activeRevision: { personaRevisionId: _COMMAND.onboardingPersonaRevisionId, modelDefinitionId: "model-1" } }]);

		await expect(_Repository(transaction).ensureReady(_COMMAND)).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Ready, agentServiceId: "personal-existing", agentRevisionId: "revision-existing", created: false, revised: false });
		expect(transaction.agentService.create).not.toHaveBeenCalled();
	});

	it("revises one existing service to the current persona without creating a second service", async function _RevisesExistingService()
	{
		const transaction = _Transaction();
		transaction.personaRevision.findUnique.mockResolvedValue(_Persona("persona-newer"));
		transaction.personaRevision.findFirst.mockResolvedValue({ personaProfileId: "profile-a" });
		transaction.agentService.findMany.mockResolvedValue([{ id: _COMMAND.onboardingId, activeRevisionId: "revision-existing", workloadProfile: "developer", activeRevision: { personaRevisionId: _COMMAND.onboardingPersonaRevisionId, modelDefinitionId: "model-1" } }]);
		transaction.agentService.findUnique.mockResolvedValue({ id: _COMMAND.onboardingId, siloId: _COMMAND.siloId, kind: "Personal", state: "Active", activeRevisionId: "revision-existing", workloadProfile: "developer", activeRevision: { personaRevisionId: _COMMAND.onboardingPersonaRevisionId, modelDefinitionId: "model-1" } });
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
			{ id: "personal-a", activeRevisionId: "revision-a", workloadProfile: "developer", activeRevision: { personaRevisionId: _COMMAND.onboardingPersonaRevisionId, modelDefinitionId: "model-1" } },
			{ id: "personal-b", activeRevisionId: "revision-b", workloadProfile: "developer", activeRevision: { personaRevisionId: _COMMAND.onboardingPersonaRevisionId, modelDefinitionId: "model-1" } },
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
		transaction.agentService.findUnique.mockResolvedValue({ id: _COMMAND.onboardingId, siloId: "other-silo", kind: "Managed", state: "Active", activeRevisionId: "revision-other", workloadProfile: "managed-default", activeRevision: { personaRevisionId: "persona-other", modelDefinitionId: "model-other" } });

		await expect(_Repository(transaction).ensureReady(_COMMAND)).resolves.toEqual({ status: PersonalAgentBootstrapStatuses.Denied, reason: PersonalAgentBootstrapDenialReasons.ServiceIdentityConflict });
		expect(transaction.agentService.create).not.toHaveBeenCalled();
	});

});
