import { AgentRevisionState, AgentServiceState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { ExecutionSubject } from "@opencrane/models/agents";

import { PrismaRuntimeAgentEffectEligibilityAuthority } from "../db/prisma-runtime-agent-effect-eligibility";

/** Builds a fully bound execution subject for the service lifecycle fence. */
function _ExecutionSubject(): ExecutionSubject
{
	return {
		schemaVersion: 1,
		siloId: "silo-1",
		agentIdentityId: "identity-1",
		principalId: "principal-1",
		identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: "silo-1", headRevision: "1", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision", verifiedAt: "2026-09-01T00:00:00.000Z" },
		membership: { principalId: "principal-1", siloId: "silo-1", revision: 1, assertionId: "membership", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision", trustedUntil: "2099-09-01T00:00:00.000Z" },
		capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision", decidedAt: "2026-09-01T00:00:00.000Z" },
		runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" },
		computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 },
		requester: { siloId: "silo-1", requesterPrincipalId: "requester-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-09-01T00:00:00.000Z" },
		admission: { authorizingPrincipalId: "authorizer-1", decisionEvidenceId: "admission-decision", admittedAt: "2026-09-01T00:00:00.000Z" },
	};
}

describe("PrismaRuntimeAgentEffectEligibilityAuthority", function _Suite()
{
	it("rejects any service outside the exact silo, active revision, lifecycle, or subject Principal", async function _RejectsMismatch()
	{
		const findFirst = vi.fn().mockResolvedValue(null);
		const transaction = { agentService: { findFirst } } as unknown as Prisma.TransactionClient;
		const authority = new PrismaRuntimeAgentEffectEligibilityAuthority(transaction);

		await expect(authority.isEligible({ siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", executionSubject: _ExecutionSubject() })).resolves.toBe(false);
		expect(findFirst).toHaveBeenCalledWith({
			where: {
				id: "service-1",
				siloId: "silo-1",
				state: AgentServiceState.Active,
				activeRevisionId: "revision-1",
				activeRevision: { is: { id: "revision-1", state: AgentRevisionState.Published } },
			},
			select: { id: true, principalId: true },
		});
	});
});
