import { AgentRevisionState, AgentServiceKind, AgentServiceState, PrincipalProvenance } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { MANAGED_AGENT_SERVICE_PRINCIPAL_ISSUER } from "../managed-agent-service-principal";
import { PrismaManagedExecutionEvidenceAuthority } from "../db/prisma-managed-execution-evidence";

/** Returns an active revision projection with an overridable persisted service Principal. */
function _Revision(principal: { readonly issuer: string; readonly subject: string; readonly provenance: PrincipalProvenance })
{
	return {
		id: "revision-1",
		digest: `sha256:${"a".repeat(64)}`,
		agentService: { principalId: "agent-service:service-1", principal },
		modelDefinitionId: "model-1",
		budget: {},
		boundaryAttachments: [],
		skillAssignments: [],
		mcpToolAssignments: [],
	};
}

describe("PrismaManagedExecutionEvidenceAuthority", function _Suite()
{
	it("denies before membership lookup when the persisted service Principal is not internal", async function _RejectsExternalPrincipal()
	{
		const assertionLookup = vi.fn();
		const transaction = {
			agentRevision: { findFirst: vi.fn().mockResolvedValue(_Revision({ issuer: "https://identity.example", subject: "service-1", provenance: PrincipalProvenance.External })) },
			verifiedFleetMembershipRevision: { findFirst: assertionLookup },
		};
		const authority = new PrismaManagedExecutionEvidenceAuthority({ trustedIssuerId: "fleet", maximumStalenessMs: 60_000, verifier: { verify: vi.fn() } as never });
		await expect(authority.load({ siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1" }, { prisma: transaction as never, admittedAtEpochMs: 1_000 })).resolves.toEqual({ outcome: "denied", reason: "identity_unavailable" });
		expect(assertionLookup).not.toHaveBeenCalled();
		expect(transaction.agentRevision.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ state: AgentRevisionState.Published, agentService: { is: expect.objectContaining({ kind: AgentServiceKind.Managed, state: AgentServiceState.Active }) } }) }));
	});

	it("accepts only the reserved issuer and exact service subject as internal identity coordinates", async function _RejectsWrongInternalCoordinates()
	{
		const authority = new PrismaManagedExecutionEvidenceAuthority({ trustedIssuerId: "fleet", maximumStalenessMs: 60_000, verifier: { verify: vi.fn() } as never });
		for (const principal of [
			{ issuer: "urn:opencrane:other", subject: "service-1", provenance: PrincipalProvenance.Internal },
			{ issuer: MANAGED_AGENT_SERVICE_PRINCIPAL_ISSUER, subject: "service-2", provenance: PrincipalProvenance.Internal },
		])
		{
			const prisma = { agentRevision: { findFirst: vi.fn().mockResolvedValue(_Revision(principal)) } };
			await expect(authority.load({ siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1" }, { prisma: prisma as never, admittedAtEpochMs: 1_000 })).resolves.toEqual({ outcome: "denied", reason: "identity_unavailable" });
		}
	});
});
