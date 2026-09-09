import { AgentRevisionState, AgentServiceKind, AgentServiceState, AuthorizationBoundaryCoverage, AuthorizationBoundaryKind, McpApprovalStatus, McpServerRevisionState, McpServerStatus, PrincipalProvenance } from "@prisma/client";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { describe, expect, it, vi } from "vitest";

import { __CompanyAssistantServiceId } from "../managed-agent-identity";
import { CompanyAssistantProvisioningDenied, CompanyAssistantToolsConflict, CompanyAssistantToolsUnavailable, PrismaCompanyAssistantProvisioningRepository } from "../db/prisma-company-assistant-provisioning";

const _NOW = new Date("2026-09-09T03:00:00.000Z");
const _CALLER = { siloId: "silo-1", principalId: "admin" };
const _SERVICE_ID = __CompanyAssistantServiceId(_CALLER.siloId);
const _POLICY = { workloadProfile: "company", promptPolicyVersion: "1", budget: { maxTurns: 2, maxTokens: 4096, maxDurationMs: 60_000 } };
const _COMMAND = { expectedActiveRevisionId: "revision-1", toolRevisionIds: ["tool-retained", "tool-new"] };

/** Keeps source content distinct from replacement tools so accidental content loss is observable. */
function _Fixture()
{
	const source = {
		id: "revision-1", siloId: _CALLER.siloId, agentServiceId: _SERVICE_ID, revision: 1,
		state: AgentRevisionState.Published, publishedAt: _NOW, promptPolicyVersion: "policy-original",
		personaRevisionId: "persona-original", modelDefinitionId: "model-original", budget: _POLICY.budget,
		skillAssignments: [{ skillId: "skill-original", skillRevisionId: "skill-revision-original" }],
		mcpToolAssignments: [{ toolRevisionId: "tool-retained" }, { toolRevisionId: "tool-old" }],
		boundaryAttachments: [{ boundaryKind: AuthorizationBoundaryKind.Group, boundaryGroupId: "group-original", boundaryPrincipalId: null, boundaryCoverage: AuthorizationBoundaryCoverage.Descendants }],
	};
	const service = { id: _SERVICE_ID, principalId: "company-principal", activeRevisionId: source.id, activeRevision: source };
	const transaction = {
		agentService: { findFirst: vi.fn().mockResolvedValue(service), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		agentRevision: { create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
		mcpToolRevision: { findMany: vi.fn().mockResolvedValue(_COMMAND.toolRevisionIds.map(id => ({ id }))) },
	};
	const decidePrincipal = vi.fn().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow });
	const admitPrincipal = vi.fn().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { decisionDigest: "sha256:allowed" } });
	const reconcileManagedResourceGrants = vi.fn().mockResolvedValue(1);
	const repository = new PrismaCompanyAssistantProvisioningRepository(transaction as never, _POLICY, { decidePrincipal, admitPrincipal } as never, { reconcileManagedResourceGrants });
	return { repository, transaction, source, service, decidePrincipal, admitPrincipal, reconcileManagedResourceGrants };
}

describe("company assistant tool assignment persistence", function _Suite()
{
	it("reads current tools through a pure current Administer decision before touching the company service", async function _ReadsCurrent()
	{
		const f = _Fixture();
		await expect(f.repository.getTools(_CALLER, _NOW)).resolves.toEqual({ agentServiceId: _SERVICE_ID, activeRevisionId: "revision-1", toolRevisionIds: ["tool-old", "tool-retained"] });
		expect(f.decidePrincipal).toHaveBeenCalledExactlyOnceWith({ ..._CALLER, resource: { kind: ProductAuthorizationResourceKinds.Organization, id: _CALLER.siloId }, action: ProductAuthorizationActions.Administer, nowEpochMs: _NOW.getTime() });
		expect(f.admitPrincipal).not.toHaveBeenCalled();
		expect(f.transaction.agentService.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: _SERVICE_ID, siloId: _CALLER.siloId, kind: AgentServiceKind.Managed, state: AgentServiceState.Active, principal: { is: { siloId: _CALLER.siloId, provenance: PrincipalProvenance.Internal } } } }));
		f.transaction.agentService.findFirst.mockClear();
		f.decidePrincipal.mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Deny });
		await expect(f.repository.getTools(_CALLER, _NOW)).rejects.toBeInstanceOf(CompanyAssistantProvisioningDenied);
		expect(f.transaction.agentService.findFirst).not.toHaveBeenCalled();
	});

	it("copies all other immutable content and reconciles only old and selected tool resources for its own principal", async function _Replaces()
	{
		const f = _Fixture();
		const original = structuredClone(f.source);
		const result = await f.repository.setTools(_CALLER, _COMMAND, _NOW);
		expect(result).toEqual({ agentServiceId: _SERVICE_ID, activeRevisionId: expect.any(String), toolRevisionIds: ["tool-new", "tool-retained"] });
		expect(result.activeRevisionId).not.toBe(f.source.id);
		expect(f.source).toEqual(original);
		expect(f.admitPrincipal.mock.calls.map(call => [call[0].resource, call[0].action])).toEqual([
			[{ kind: ProductAuthorizationResourceKinds.Organization, id: _CALLER.siloId }, ProductAuthorizationActions.Administer],
			[{ kind: ProductAuthorizationResourceKinds.McpToolRevision, id: "tool-new" }, ProductAuthorizationActions.Assign],
			[{ kind: ProductAuthorizationResourceKinds.McpToolRevision, id: "tool-retained" }, ProductAuthorizationActions.Assign],
		]);
		expect(f.transaction.agentRevision.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
			id: result.activeRevisionId, revision: 2, parentRevision: { connect: { id_siloId: { id: "revision-1", siloId: _CALLER.siloId } } },
			promptPolicyVersion: "policy-original", personaRevisionId: "persona-original", modelDefinition: { connect: { id_siloId: { id: "model-original", siloId: _CALLER.siloId } } }, budget: _POLICY.budget,
			skillAssignments: { create: [{ skillId: "skill-original", skillRevisionId: "skill-revision-original" }] },
			boundaryAttachments: { create: [{ siloId: _CALLER.siloId, boundaryKind: AuthorizationBoundaryKind.Group, boundaryGroupId: "group-original", boundaryCoverage: AuthorizationBoundaryCoverage.Descendants }] },
			mcpToolAssignments: { create: ["tool-new", "tool-retained"].map(toolRevisionId => ({ toolRevisionId, siloId: _CALLER.siloId })) },
		}) }));
		const reconciled = f.reconcileManagedResourceGrants.mock.calls.map(call => call[0]);
		expect(reconciled.map(call => call.resource.id)).toEqual(["tool-new", "tool-old", "tool-retained"]);
		for (const call of reconciled)
		{
			expect(call).toMatchObject({ siloId: _CALLER.siloId, managerId: `company-assistant:${_SERVICE_ID}`, resource: { kind: ProductAuthorizationResourceKinds.McpToolRevision }, now: _NOW });
			if (call.resource.id === "tool-old")
				expect(call.grants).toEqual([]);
			else
				expect(call.grants).toEqual(["use", "invoke"].map(action => expect.objectContaining({ subject: { kind: "principal", principalId: "company-principal" }, boundary: { kind: "personal", principalId: "company-principal" }, boundaryCoverage: "exact", capability: expect.objectContaining({ capabilityId: `mcp-tool-revision:${action}` }) })));
		}
		expect(f.transaction.agentService.updateMany).toHaveBeenCalledExactlyOnceWith({ where: { id: _SERVICE_ID, siloId: _CALLER.siloId, kind: AgentServiceKind.Managed, state: AgentServiceState.Active, activeRevisionId: "revision-1" }, data: { activeRevisionId: result.activeRevisionId, updatedAt: _NOW } });
		expect(f.transaction.agentRevision.update).toHaveBeenCalledExactlyOnceWith({ where: { id_siloId: { id: result.activeRevisionId, siloId: _CALLER.siloId } }, data: { state: AgentRevisionState.Published, publishedAt: _NOW } });
	});

	it("validates exact same-silo ready tool revisions on active published servers before any revision write", async function _RequiresPublishedTools()
	{
		const f = _Fixture();
		f.transaction.mcpToolRevision.findMany.mockResolvedValue([]);
		await expect(f.repository.setTools(_CALLER, _COMMAND, _NOW)).rejects.toBeInstanceOf(CompanyAssistantProvisioningDenied);
		expect(f.transaction.mcpToolRevision.findMany).toHaveBeenCalledExactlyOnceWith({ where: { id: { in: ["tool-new", "tool-retained"] }, siloId: _CALLER.siloId, serverRevision: { is: { siloId: _CALLER.siloId, state: McpServerRevisionState.Ready, server: { is: { siloId: _CALLER.siloId, status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published } } } } }, select: { id: true } });
		expect(f.transaction.agentRevision.create).not.toHaveBeenCalled();
		expect(f.reconcileManagedResourceGrants).not.toHaveBeenCalled();
	});

	it.each([1, 2, 3])("denies decision %s without revision or grant changes", async function _RequiresPermission(index)
	{
		const f = _Fixture();
		f.admitPrincipal.mockReset().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Deny, evidence: null });
		for (let decision = 1; decision < index; decision += 1)
			f.admitPrincipal.mockResolvedValueOnce({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { decisionDigest: "sha256:allowed" } });
		await expect(f.repository.setTools(_CALLER, _COMMAND, _NOW)).rejects.toBeInstanceOf(CompanyAssistantProvisioningDenied);
		expect(f.transaction.agentRevision.create).not.toHaveBeenCalled();
		expect(f.reconcileManagedResourceGrants).not.toHaveBeenCalled();
	});

	it("requires fresh permissions for a current same-set no-op without restoring grants", async function _NoOp()
	{
		const f = _Fixture();
		const command = { expectedActiveRevisionId: "revision-1", toolRevisionIds: ["tool-retained", "tool-old"] };
		f.transaction.mcpToolRevision.findMany.mockResolvedValue(command.toolRevisionIds.map(id => ({ id })));
		await expect(f.repository.setTools(_CALLER, command, _NOW)).resolves.toEqual({ agentServiceId: _SERVICE_ID, activeRevisionId: "revision-1", toolRevisionIds: ["tool-old", "tool-retained"] });
		expect(f.admitPrincipal).toHaveBeenCalledTimes(3);
		expect(f.transaction.agentRevision.create).not.toHaveBeenCalled();
		expect(f.reconcileManagedResourceGrants).not.toHaveBeenCalled();
		f.admitPrincipal.mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Deny, evidence: null });
		await expect(f.repository.setTools(_CALLER, command, _NOW)).rejects.toBeInstanceOf(CompanyAssistantProvisioningDenied);
	});

	it("rejects stale same-set retries before equality and permits GET to return the authoritative successor", async function _RejectsUncertainRetry()
	{
		const f = _Fixture();
		await expect(f.repository.setTools(_CALLER, { expectedActiveRevisionId: "previous-revision", toolRevisionIds: ["tool-old", "tool-retained"] }, _NOW)).rejects.toBeInstanceOf(CompanyAssistantToolsConflict);
		expect(f.transaction.agentRevision.create).not.toHaveBeenCalled();
		expect(f.reconcileManagedResourceGrants).not.toHaveBeenCalled();
		await expect(f.repository.getTools(_CALLER, _NOW)).resolves.toMatchObject({ activeRevisionId: "revision-1", toolRevisionIds: ["tool-old", "tool-retained"] });
	});

	it("removes every old tool grant when the selected set is empty", async function _RemovesAll()
	{
		const f = _Fixture();
		f.transaction.mcpToolRevision.findMany.mockResolvedValue([]);
		await expect(f.repository.setTools(_CALLER, { expectedActiveRevisionId: "revision-1", toolRevisionIds: [] }, _NOW)).resolves.toMatchObject({ toolRevisionIds: [] });
		expect(f.reconcileManagedResourceGrants.mock.calls.map(call => [call[0].resource.id, call[0].grants])).toEqual([["tool-old", []], ["tool-retained", []]]);
	});

	it("throws a transaction rollback error when the active pointer compare-and-swap loses", async function _RollsBackCas()
	{
		const f = _Fixture();
		f.transaction.agentService.updateMany.mockResolvedValue({ count: 0 });
		await expect(f.repository.setTools(_CALLER, _COMMAND, _NOW)).rejects.toBeInstanceOf(CompanyAssistantToolsConflict);
	});

	it.each([null, { activeRevisionId: "other" }, { principalId: null }, { activeRevision: null }])("refuses unavailable or mismatched service authority %j", async function _RequiresCurrentService(patch)
	{
		const f = _Fixture();
		f.transaction.agentService.findFirst.mockResolvedValue(patch === null ? null : { ...f.service, ...patch });
		await expect(f.repository.setTools(_CALLER, _COMMAND, _NOW)).rejects.toBeInstanceOf(CompanyAssistantToolsUnavailable);
		expect(f.transaction.agentRevision.create).not.toHaveBeenCalled();
	});

	it.each([{ state: AgentRevisionState.Draft }, { publishedAt: null }, { siloId: "foreign" }, { agentServiceId: "foreign" }])("refuses unpublished or substituted source content %j", async function _RequiresPublishedSource(patch)
	{
		const f = _Fixture();
		f.transaction.agentService.findFirst.mockResolvedValue({ ...f.service, activeRevision: { ...f.source, ...patch } });
		await expect(f.repository.setTools(_CALLER, _COMMAND, _NOW)).rejects.toBeInstanceOf(CompanyAssistantToolsUnavailable);
		expect(f.transaction.agentRevision.create).not.toHaveBeenCalled();
	});
});
