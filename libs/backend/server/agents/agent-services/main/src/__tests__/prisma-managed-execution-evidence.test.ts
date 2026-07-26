import { AgentRevisionState, AgentServiceKind, AgentServiceState, FleetMembershipScopeKind, GrantAccess, GrantPayloadType, GrantScope, GrantSubjectType } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { FleetMembershipSignatureVerifier } from "@opencrane/backend/server/iam/membership";

import { PrismaManagedExecutionEvidenceAuthority } from "../prisma-managed-execution-evidence.js";

/** Exact signature evidence returned by the test verifier. */
const _verifier: FleetMembershipSignatureVerifier = {
	async verify(revision)
	{
		return { verified: true, issuerId: revision.issuerId, issuerKeyId: revision.issuerKeyId, revision: revision.revision, siloId: revision.siloId, payloadDigest: revision.payloadDigest, signature: revision.signature };
	},
};

/** Builds the narrow transaction surface exercised by one successful evidence load. */
function _Transaction(scope: GrantScope = GrantScope.Project)
{
	const assertion = { assertionId: "assertion-1", siloId: "silo-1", subjectId: "agent-service:service-1", scopeKind: FleetMembershipScopeKind.Project, organizationId: "org-1", scopeResourceId: "project-1" };
	const signedRevision = { id: "membership-1", revision: 7, issuerId: "fleet-1", issuerKeyId: "fleet-key-1", siloId: "silo-1", issuedAt: new Date(1_000), expiresAt: new Date(20_000), payloadDigest: `sha256:${"a".repeat(64)}`, signature: "signature", assertions: [assertion] };
	let membershipReads = 0;
	return {
		$queryRaw: vi.fn().mockResolvedValue([]),
		agentRevision: {
			findFirst: vi.fn().mockResolvedValue({
				id: "revision-1",
				digest: `sha256:${"b".repeat(64)}`,
				modelDefinitionId: "model-1",
				budget: { maxTurns: 3, maxTokens: 1_000, maxDurationMs: 60_000 },
				scopeAttachments: [{ scope, subjectType: scope === GrantScope.Personal ? GrantSubjectType.User : GrantSubjectType.Group, subjectId: scope === GrantScope.Personal ? "user-1" : "project-1" }],
				skillAssignments: [{ skillId: "skill-1", skillRevisionId: "skill-revision-1" }],
				integrationAssignments: [{ integrationId: "integration-1", custodyReferenceId: "custody-1", allowedTools: ["search"] }],
				state: AgentRevisionState.Published,
				agentService: { kind: AgentServiceKind.Managed, state: AgentServiceState.Active },
			}),
		},
		verifiedFleetMembershipRevision: {
			findFirst: vi.fn().mockImplementation(async function _membership()
			{
				membershipReads += 1;
				if (membershipReads === 1) return { assertions: [assertion] };
				return signedRevision;
			}),
		},
		highestAcceptedFleetMembership: {
			findUnique: vi.fn().mockResolvedValue(null),
			upsert: vi.fn().mockResolvedValue({}),
		},
		auditDecision: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
		group: { findMany: vi.fn().mockResolvedValue([]) },
		grant: {
			findMany: vi.fn().mockResolvedValue([{
				id: "grant-1",
				payloadType: GrantPayloadType.Awareness,
				payloadId: "project-1",
				access: GrantAccess.Allow,
				priority: 10,
				scope: GrantScope.Project,
				subjectType: GrantSubjectType.Tenant,
				subjectId: "agent-service:service-1",
				createdAt: new Date(1_000),
			}]),
		},
	};
}

describe("PrismaManagedExecutionEvidenceAuthority", function ()
{
	it("derives requester-independent signed service identity and exact effective attachments", async function ()
	{
		const authority = new PrismaManagedExecutionEvidenceAuthority({ trustedIssuerId: "fleet-1", maximumStalenessMs: 10_000, verifier: _verifier });
		const prisma = _Transaction();
		const result = await authority.load({ siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1" }, { prisma: prisma as never, admittedAtEpochMs: 5_000 });

		expect(result).toMatchObject({
			outcome: "loaded",
			value: {
				identity: {
					kind: "service",
					executionSubjectId: "agent-service:service-1",
					agentServiceId: "service-1",
					organizationId: "org-1",
					fleetMembershipRevision: 7,
					effectiveScopeAttachments: [{ scope: "project", subjectType: "group", subjectId: "project-1" }],
				},
			},
		});
		if (result.outcome !== "loaded") throw new Error("expected loaded evidence");
		expect(result.value.capabilitySetDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
		expect(result.value.identity.effectiveScopeAttachmentDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
	});

	it("refuses personal knowledge attachments before a managed snapshot can be assembled", async function ()
	{
		const authority = new PrismaManagedExecutionEvidenceAuthority({ trustedIssuerId: "fleet-1", maximumStalenessMs: 10_000, verifier: _verifier });
		const prisma = _Transaction(GrantScope.Personal);

		await expect(authority.load({ siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1" }, { prisma: prisma as never, admittedAtEpochMs: 5_000 })).resolves.toEqual({ outcome: "denied", reason: "memory_scope_unavailable" });
	});
});
