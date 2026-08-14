import type { ManagedExecutionEvidenceAuthority } from "@opencrane/backend/server/agents/agent-services";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { describe, expect, it, vi } from "vitest";
import { AgentServiceKinds } from "@opencrane/models/agents";

import { ManagedExecutionIdentityEnvelopeSource } from "../managed-execution-identity-envelope-source";

/** Creates one managed service authority accepted by the source adapter. */
function _Run(): InitialRunAuthority
{
	return { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: AgentServiceKinds.Managed, effectiveContractDigest: `sha256:${"a".repeat(64)}`, promptCompilerVersion: "v1", trigger: "managed_invocation", delegatedUserId: null, rootRunId: "run-1", parentRunId: null };
}

/** Creates the admission command with the canonical service principal. */
function _Command(identityKind: "user" | "service" = "service")
{
	return identityKind === "service"
		? { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: null, identityKind, trigger: "managed_invocation", requestIdempotencyKey: "request-1" } as never
		: { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: null, identityKind, trigger: "interactive", executionSubjectId: "user-1", requestIdempotencyKey: "request-1" } as never;
}

/** Creates a stand-in transaction, to check the adapter passes the same transaction through. */
function _Transaction(): RunAdmissionTransaction
{
	return { prisma: {} as never, admittedAt: "2026-07-26T00:00:00.000Z", admittedAtEpochMs: Date.parse("2026-07-26T00:00:00.000Z") };
}

/** Creates a stub managed evidence authority whose response each test can replace. */
function _Evidence(result: unknown): ManagedExecutionEvidenceAuthority
{
	return { load: vi.fn().mockResolvedValue(result) } as never;
}

/** Creates one service identity for service-1, with valid SHA-256 digests. */
function _LoadedEvidence()
{
	return { outcome: "loaded", value: { identity: { kind: "service", executionSubjectId: "agent-service:service-1", agentServiceId: "service-1", organizationId: "org-1", fleetMembershipRevision: 4, fleetMembershipIssuer: "fleet-1", fleetMembershipIssuerKeyId: "key-1", fleetMembershipAssertionId: "assertion-1", fleetMembershipPayloadDigest: `sha256:${"a".repeat(64)}`, fleetMembershipTrustedUntil: "2026-07-27T00:00:00.000Z", effectiveScopeAttachments: [], effectiveScopeAttachmentDigest: `sha256:${"b".repeat(64)}` }, capabilitySetDigest: `sha256:${"c".repeat(64)}` } } as const;
}

describe("ManagedExecutionIdentityEnvelopeSource", function _DescribeManagedExecutionIdentityEnvelopeSource()
{
	it("adapts only control-plane revalidated service evidence into a tagged snapshot identity", async function _LoadsManagedEvidence()
	{
		const evidence = _Evidence(_LoadedEvidence());
		const transaction = _Transaction();
		await expect(new ManagedExecutionIdentityEnvelopeSource(evidence).load(_Command(), _Run(), transaction)).resolves.toEqual({ outcome: "loaded", value: { ..._LoadedEvidence().value.identity, capabilitySetDigest: _LoadedEvidence().value.capabilitySetDigest } });
		expect(evidence.load).toHaveBeenCalledWith({ siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1" }, { prisma: transaction.prisma, admittedAtEpochMs: transaction.admittedAtEpochMs });
	});

	it("denies a caller subject or returned service identity that is not bound to the admitted service", async function _DeniesMismatchedService()
	{
		await expect(new ManagedExecutionIdentityEnvelopeSource(_Evidence(_LoadedEvidence())).load(_Command("user"), _Run(), _Transaction())).resolves.toEqual({ outcome: "denied", reason: "identity_unavailable" });
		const mismatched = _LoadedEvidence();
		const identity = { ...mismatched.value.identity, agentServiceId: "service-other" };
		await expect(new ManagedExecutionIdentityEnvelopeSource(_Evidence({ outcome: "loaded", value: { ...mismatched.value, identity } })).load(_Command(), _Run(), _Transaction())).resolves.toEqual({ outcome: "denied", reason: "identity_unavailable" });
	});
});
