import { describe, expect, it } from "vitest";
import { ExecutionSubjectMembershipKinds } from "@opencrane/models/agents";

import { ___ExecutionSubjectSchema } from "../index";

/** Creates one complete execution subject with separate requester and admission authority. */
function _Subject(): Record<string, unknown>
{
	return {
		schemaVersion: 1,
		siloId: "silo-1",
		agentIdentityId: "identity-1",
		principalId: "principal-agent-1",
		identity: { agentIdentityId: "identity-1", principalId: "principal-agent-1", siloId: "silo-1", headRevision: "8", headDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", decisionEvidenceId: "identity-decision-1", verifiedAt: "2026-09-01T00:00:00.000Z" },
		membership: { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "principal-agent-1", siloId: "silo-1", revision: 21, assertionId: "membership-assertion-1", payloadDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", decisionEvidenceId: "membership-decision-1", trustedUntil: "2026-09-01T01:00:00.000Z" },
		capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", effectiveContractDigest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", decisionEvidenceId: "capability-decision-1", decidedAt: "2026-09-01T00:00:00.000Z" },
		runScope: { siloId: "silo-1", runId: "run-1", attempt: 2, agentServiceId: "agent-service-1", agentRevisionId: "agent-revision-1" },
		computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 4 },
		requester: { siloId: "silo-1", requesterPrincipalId: "principal-requester-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-09-01T00:00:00.000Z", membership: { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "principal-requester-1", siloId: "silo-1", revision: 21, assertionId: "requester-assertion-1", payloadDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", decisionEvidenceId: "requester-membership-1", trustedUntil: "2026-09-01T01:00:00.000Z" } },
		admission: { authorizingPrincipalId: "principal-authorizer-1", decisionEvidenceId: "admission-decision-1", admittedAt: "2026-09-01T00:00:00.000Z" },
	};
}

/** Creates a managed subject whose service Principal differs from the human requester. */
function _Managed(): Record<string, unknown>
{
	return { ..._Subject(), membership: { kind: ExecutionSubjectMembershipKinds.Managed, principalId: "principal-agent-1", siloId: "silo-1", agentServiceId: "agent-service-1", agentRevisionId: "agent-revision-1", agentRevisionDigest: `sha256:${"c".repeat(64)}`, decisionEvidenceId: "managed-membership-1", trustedUntil: "2026-09-01T01:00:00.000Z" } };
}

describe("execution subject structure", function _DescribeExecutionSubjectStructure()
{
	it("keeps human membership separate from managed execution authority", function _PreservesIndependentAuthority()
	{
		const parsed = ___ExecutionSubjectSchema.parse(_Managed());
		expect(parsed.membership.kind).toBe(ExecutionSubjectMembershipKinds.Managed);
		expect(parsed.principalId).toBe("principal-agent-1");
		expect(parsed.requester.membership.principalId).toBe("principal-requester-1");
		expect(___ExecutionSubjectSchema.safeParse(_Subject()).success).toBe(true);
	});

	it("rejects service sentinels and missing or unknown membership kinds", function _RejectsUnsupportedMembership()
	{
		const subject = _Subject();
		const membership = { ...subject.membership as Record<string, unknown> };
		delete membership.kind;
		expect(___ExecutionSubjectSchema.safeParse({ ...subject, membership }).success).toBe(false);
		expect(___ExecutionSubjectSchema.safeParse({ ...subject, membership: { ...membership, kind: "unverified" } }).success).toBe(false);
		expect(___ExecutionSubjectSchema.safeParse({ ...subject, principalId: "agent-service:service-1" }).success).toBe(false);
	});

	it.each(["siloId", "principalId", "agentServiceId", "agentRevisionId"])("rejects mismatched managed %s", function _RejectsManagedMismatch(field)
	{
		const subject = _Managed();
		const membership = { ...subject.membership as Record<string, unknown>, [field]: "foreign" };
		expect(___ExecutionSubjectSchema.safeParse({ ...subject, membership }).success).toBe(false);
	});

	it.each(["siloId", "principalId"])("rejects mismatched requester %s", function _RejectsRequesterMismatch(field)
	{
		const subject = _Managed();
		const requester = subject.requester as Record<string, unknown>;
		const membership = { ...requester.membership as Record<string, unknown>, [field]: "foreign" };
		expect(___ExecutionSubjectSchema.safeParse({ ...subject, requester: { ...requester, membership } }).success).toBe(false);
	});

	it("rejects a managed binding presented as the human requester's membership", function _RejectsManagedRequester()
	{
		const subject = _Managed();
		const requester = { ...subject.requester as Record<string, unknown>, membership: subject.membership };
		expect(___ExecutionSubjectSchema.safeParse({ ...subject, requester }).success).toBe(false);
	});

	it("accepts the first Kurrent identity revision and rejects missing or foreign identity and capability coordinates", function _ValidatesIdentityAndCapability()
	{
		const subject = _Managed();
		const identity = { ...subject.identity as Record<string, unknown>, headRevision: "0" };
		expect(___ExecutionSubjectSchema.safeParse({ ...subject, identity }).success).toBe(true);
		expect(___ExecutionSubjectSchema.safeParse({ ...subject, identity: { ...identity, agentIdentityId: "foreign" } }).success).toBe(false);
		expect(___ExecutionSubjectSchema.safeParse({ ...subject, capability: undefined }).success).toBe(false);
		const capability = { ...subject.capability as Record<string, unknown>, computerId: "foreign" };
		expect(___ExecutionSubjectSchema.safeParse({ ...subject, capability }).success).toBe(false);
	});
});

/** Builds local evidence without copying Fleet-only proof fields. */
function _Standalone(principalId: string)
{
	return { kind: ExecutionSubjectMembershipKinds.Standalone, principalId, siloId: "silo-1", issuer: "https://issuer.example", subjectId: principalId, membershipId: `membership-${principalId}`, membershipUpdatedAt: "2026-09-01T00:00:00.000Z", observedAt: "2026-09-01T00:01:00.000Z", trustedUntil: "2026-09-01T00:06:00.000Z" };
}

describe("standalone execution subject structure", function _StandaloneSuite()
{
	it("rejects mixed human deployment modes", function _RejectsMixedModes()
	{
		const subject = ___ExecutionSubjectSchema.parse(_Subject());
		expect(___ExecutionSubjectSchema.safeParse({ ...subject, membership: _Standalone(subject.principalId) }).success).toBe(false);
	});

	it.each([false, true])("accepts local human evidence while preserving managed=%s execution", function _Accepts(managed)
	{
		const subject = ___ExecutionSubjectSchema.parse(managed ? _Managed() : _Subject());
		const membership = managed ? subject.membership : _Standalone(subject.principalId);
		const requester = { ...subject.requester, membership: _Standalone(subject.requester.requesterPrincipalId) };
		expect(___ExecutionSubjectSchema.safeParse({ ...subject, membership, requester }).success).toBe(true);
		for (const patch of [{ principalId: "wrong" }, { siloId: "wrong" }, { revision: 1 }, { assertionId: "fabricated" }, { observedAt: "2026-09-01T00:07:00.000Z" }])
			expect(___ExecutionSubjectSchema.safeParse({ ...subject, membership, requester: { ...requester, membership: { ...requester.membership, ...patch } } }).success).toBe(false);
	});
});
