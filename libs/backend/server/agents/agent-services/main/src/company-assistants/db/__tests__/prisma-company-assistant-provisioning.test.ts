import { AgentRevisionState, AgentServiceKind, AgentServiceState, PrincipalProvenance } from "@prisma/client";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions } from "@opencrane/models/authorization";
import { describe, expect, it, vi } from "vitest";

import { PrismaCompanyAssistantProvisioningRepository } from "../prisma-company-assistant-provisioning";

const _NOW = new Date("2026-09-07T10:00:00.000Z");
const _CALLER = { siloId: "silo-1", principalId: "admin" };
const _COMMAND = { name: "Company assistant", modelDefinitionId: "model-1", invokerPrincipalIds: ["human-1"] };
const _POLICY = { workloadProfile: "company", promptPolicyVersion: "1", budget: { maxTurns: 1, maxTokens: 4096, maxDurationMs: 60_000 } };

/** Records writes separately so denial and existing-result tests prove that no authority was restored. */
function _Fixture()
{
	const transaction = {
		principal: { findMany: vi.fn().mockResolvedValue([{ id: "human-1", subject: "human-subject" }]), create: vi.fn().mockResolvedValue({}) },
		orgMembership: { findMany: vi.fn().mockResolvedValue([{ subject: "human-subject" }]) },
		agentService: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
		agentRevision: { create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
	};
	const admitPrincipal = vi.fn().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { decisionDigest: "sha256:allowed" } });
	const reconcileManagedResourceGrants = vi.fn().mockResolvedValue(1);
	const authority = new PrismaCompanyAssistantProvisioningRepository(transaction as never, _POLICY, { admitPrincipal } as never, { reconcileManagedResourceGrants });
	return { transaction, admitPrincipal, reconcileManagedResourceGrants, authority };
}

describe("PrismaCompanyAssistantProvisioningRepository", function _Suite()
{
	it("creates a published empty revision, one Internal Principal and only the selected exact grants", async function _Provisions()
	{
		const f = _Fixture();
		const result = await f.authority.provision(_CALLER, _COMMAND, _NOW);
		expect(result).toMatchObject({ created: true, name: "Company assistant", createdByPrincipalId: "admin" });
		expect(result.principalId).not.toBe(_CALLER.principalId);
		expect(f.admitPrincipal.mock.calls.map(call => call[0].action)).toEqual([ProductAuthorizationActions.Administer, ProductAuthorizationActions.Use]);
		expect(f.transaction.principal.create).toHaveBeenCalledWith({ data: { id: result.principalId, siloId: _CALLER.siloId, issuer: "urn:opencrane:agent-service", subject: result.agentServiceId, provenance: PrincipalProvenance.Internal, email: null, displayName: _COMMAND.name, createdAt: _NOW } });
		expect(f.transaction.agentRevision.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ personaRevisionId: null, skillAssignments: { create: [] }, mcpToolAssignments: { create: [] }, boundaryAttachments: { create: [] } }) }));
		expect(f.transaction.agentRevision.update).toHaveBeenCalledWith({ where: { id: result.agentRevisionId }, data: { state: AgentRevisionState.Published, publishedAt: _NOW } });
		const calls = f.reconcileManagedResourceGrants.mock.calls.map(call => call[0]);
		expect(calls[0].grants.map((grant: { subject: unknown }) => grant.subject)).toEqual(Array(3).fill({ kind: "principal", principalId: "human-1" }));
		expect(calls[1].grants).toHaveLength(1);
		expect(calls[1].grants[0]).toMatchObject({ subject: { principalId: result.principalId }, capability: { capabilityId: "model-definition:use" } });
	});

	it.each(["admin", "model", "member"])("does not write when %s authority is absent", async function _Rejects(kind)
	{
		const f = _Fixture();
		if (kind === "member")
			f.transaction.orgMembership.findMany.mockResolvedValue([]);
		else
		{
			f.admitPrincipal.mockReset().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Deny, evidence: null });
			if (kind === "model")
				f.admitPrincipal.mockResolvedValueOnce({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { decisionDigest: "sha256:admin" } });
		}
		await expect(f.authority.provision(_CALLER, _COMMAND, _NOW)).rejects.toThrow();
		expect(f.transaction.principal.create).not.toHaveBeenCalled();
		expect(f.reconcileManagedResourceGrants).not.toHaveBeenCalled();
	});

	it("returns the existing assistant without applying changed choices or restoring revoked grants", async function _RetriesExisting()
	{
		const f = _Fixture();
		f.transaction.agentService.findFirst.mockResolvedValue({ kind: AgentServiceKind.Managed, state: AgentServiceState.Active, activeRevisionId: "revision-current", principal: { id: "company-principal", provenance: PrincipalProvenance.Internal }, revisions: [{ id: "revision-first", authoredBy: "original-admin" }], name: "Original name", createdAt: _NOW });
		const result = await f.authority.provision(_CALLER, { ..._COMMAND, name: "Ignored replacement", invokerPrincipalIds: ["new-human"] }, _NOW);
		expect(result).toMatchObject({ created: false, name: "Original name", agentRevisionId: "revision-current", identityEventId: "revision-first", createdByPrincipalId: "original-admin" });
		expect(f.transaction.principal.create).not.toHaveBeenCalled();
		expect(f.transaction.agentService.update).not.toHaveBeenCalled();
		expect(f.reconcileManagedResourceGrants).not.toHaveBeenCalled();
	});
});
