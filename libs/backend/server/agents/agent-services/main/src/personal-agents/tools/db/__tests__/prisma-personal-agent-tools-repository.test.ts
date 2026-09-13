import { AgentRevisionState, AuthorizationBoundaryCoverage, AuthorizationBoundaryKind } from "@prisma/client";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { describe, expect, it, vi } from "vitest";

import { PersonalAgentToolsConflict, PersonalAgentToolsDenied, PersonalAgentToolsUnavailable } from "../../personal-agent-tools.errors";
import { PrismaPersonalAgentToolsRepository } from "../prisma-personal-agent-tools-repository";

const _NOW = new Date("2026-09-13T07:00:00.000Z");
const _CALLER = { siloId: "silo-1", subjectId: "subject-1" } as const;
const _PRODUCT_CALLER = { ..._CALLER, principalId: "principal-1" } as const;
const _COMMAND = { expectedActiveRevisionId: "revision-1", toolRevisionIds: ["tool-retained", "tool-new"] } as const;

/** Creates a complete personal revision so preservation is observable. */
function _Fixture()
{
	const source = {
		id: "revision-1", siloId: _CALLER.siloId, agentServiceId: "service-1", revision: 4, state: AgentRevisionState.Published, publishedAt: _NOW,
		promptPolicyVersion: "policy-original", personaRevisionId: "persona-revision-1", modelDefinitionId: "model-1", budget: { maxTurns: 4, maxTokens: 8_000, maxDurationMs: 60_000 },
		skillAssignments: [{ skillId: "skill-1", skillRevisionId: "skill-revision-1" }],
		mcpToolAssignments: [{ toolRevisionId: "tool-old" }, { toolRevisionId: "tool-retained" }],
		boundaryAttachments: [{ boundaryKind: AuthorizationBoundaryKind.Personal, boundaryGroupId: null, boundaryPrincipalId: "principal-1", boundaryCoverage: AuthorizationBoundaryCoverage.Exact }],
	};
	const service = { id: "service-1", activeRevisionId: source.id, activeRevision: source };
	const transaction = {
		personaRevision: { findMany: vi.fn().mockResolvedValue([{ id: "persona-revision-1", personaProfileId: "persona-profile-1" }]) },
		agentService: { findMany: vi.fn().mockResolvedValue([service]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		agentRevision: { findFirst: vi.fn().mockResolvedValue({ id: source.id }), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
		mcpToolRevision: { findMany: vi.fn().mockResolvedValue(_COMMAND.toolRevisionIds.map(id => ({ id }))) },
	};
	const productEffects = {
		resolveCaller: vi.fn().mockResolvedValue(_PRODUCT_CALLER),
		reconcileCurrent: vi.fn(), admitInitialCreation: vi.fn(), admitInitialPublication: vi.fn(), admitRevisionSelection: vi.fn().mockResolvedValue(undefined), admitRevisionPublication: vi.fn().mockResolvedValue(undefined), admitUnusedProfileChange: vi.fn(),
	};
	const decidePrincipal = vi.fn().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow });
	const repository = new PrismaPersonalAgentToolsRepository(transaction as never, productEffects, { decidePrincipal } as never);
	return { repository, transaction, productEffects, decidePrincipal, source };
}

describe("personal agent tool assignment persistence", function _Suite()
{
	it("reads one subject-owned current selection through AgentService Edit", async function _Reads()
	{
		const f = _Fixture();
		await expect(f.repository.getTools(_CALLER, _NOW)).resolves.toEqual({ agentServiceId: "service-1", activeRevisionId: "revision-1", toolRevisionIds: ["tool-old", "tool-retained"] });
		expect(f.decidePrincipal).toHaveBeenCalledExactlyOnceWith({ siloId: _CALLER.siloId, principalId: _PRODUCT_CALLER.principalId, resource: { kind: ProductAuthorizationResourceKinds.AgentService, id: "service-1" }, action: ProductAuthorizationActions.Edit, nowEpochMs: _NOW.getTime() });
	});

	it("copies persona, model, skills, budget and boundaries while replacing only tools", async function _Replaces()
	{
		const f = _Fixture();
		const result = await f.repository.setTools(_CALLER, _COMMAND, _NOW);
		expect(result).toEqual({ agentServiceId: "service-1", activeRevisionId: expect.any(String), toolRevisionIds: ["tool-new", "tool-retained"] });
		expect(f.productEffects.admitRevisionSelection).toHaveBeenCalledWith(expect.objectContaining({ caller: _PRODUCT_CALLER, selectedResource: "tool", source: { agentServiceId: "service-1", agentRevisionId: "revision-1", personaProfileId: "persona-profile-1", modelDefinitionId: "model-1", mcpToolRevisionIds: ["tool-old", "tool-retained"] }, target: expect.objectContaining({ modelDefinitionId: "model-1", mcpToolRevisionIds: ["tool-new", "tool-retained"] }) }));
		expect(f.transaction.agentRevision.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ revision: 5, personaRevisionId: "persona-revision-1", budget: { maxTurns: 4, maxTokens: 8_000, maxDurationMs: 60_000 }, skillAssignments: { create: [{ skillId: "skill-1", skillRevisionId: "skill-revision-1" }] }, mcpToolAssignments: { create: [{ toolRevisionId: "tool-new", siloId: _CALLER.siloId }, { toolRevisionId: "tool-retained", siloId: _CALLER.siloId }] } }) }));
		expect(f.productEffects.admitRevisionPublication).toHaveBeenCalledOnce();
		expect(f.transaction.agentService.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ activeRevisionId: "revision-1" }), data: { activeRevisionId: result.activeRevisionId, updatedAt: _NOW } }));
	});

	it("rechecks the current revision before availability and assignment admission", async function _ConflictsAndDenies()
	{
		const stale = _Fixture();
		await expect(stale.repository.setTools(_CALLER, { ..._COMMAND, expectedActiveRevisionId: "stale" }, _NOW)).rejects.toBeInstanceOf(PersonalAgentToolsConflict);
		expect(stale.transaction.mcpToolRevision.findMany).not.toHaveBeenCalled();

		const unavailable = _Fixture();
		unavailable.transaction.mcpToolRevision.findMany.mockResolvedValue([]);
		await expect(unavailable.repository.setTools(_CALLER, _COMMAND, _NOW)).rejects.toBeInstanceOf(PersonalAgentToolsDenied);
		expect(unavailable.productEffects.admitRevisionSelection).not.toHaveBeenCalled();
	});

	it("returns an authorized unchanged selection without a successor", async function _NoOp()
	{
		const f = _Fixture();
		const command = { expectedActiveRevisionId: "revision-1", toolRevisionIds: ["tool-retained", "tool-old"] };
		f.transaction.mcpToolRevision.findMany.mockResolvedValue(command.toolRevisionIds.map(id => ({ id })));
		await expect(f.repository.setTools(_CALLER, command, _NOW)).resolves.toEqual({ agentServiceId: "service-1", activeRevisionId: "revision-1", toolRevisionIds: ["tool-old", "tool-retained"] });
		expect(f.productEffects.admitRevisionSelection).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ selectedResource: "tool", source: expect.objectContaining({ agentRevisionId: "revision-1", mcpToolRevisionIds: ["tool-old", "tool-retained"] }), target: expect.objectContaining({ agentRevisionId: "revision-1", mcpToolRevisionIds: ["tool-old", "tool-retained"] }) }));
		expect(f.productEffects.admitRevisionPublication).not.toHaveBeenCalled();
		expect(f.transaction.agentRevision.create).not.toHaveBeenCalled();
		expect(f.transaction.agentService.updateMany).not.toHaveBeenCalled();
	});

	it("fails closed for ambiguous services, caller resolution and lost active-pointer CAS", async function _FailsClosed()
	{
		const ambiguous = _Fixture();
		ambiguous.transaction.agentService.findMany.mockResolvedValue([{}, {}] as never);
		await expect(ambiguous.repository.getTools(_CALLER, _NOW)).rejects.toBeInstanceOf(PersonalAgentToolsUnavailable);

		const caller = _Fixture();
		caller.productEffects.resolveCaller.mockResolvedValue(null);
		await expect(caller.repository.getTools(_CALLER, _NOW)).rejects.toBeInstanceOf(PersonalAgentToolsDenied);

		const cas = _Fixture();
		cas.transaction.agentService.updateMany.mockResolvedValue({ count: 0 });
		await expect(cas.repository.setTools(_CALLER, _COMMAND, _NOW)).rejects.toBeInstanceOf(PersonalAgentToolsConflict);
	});
});
