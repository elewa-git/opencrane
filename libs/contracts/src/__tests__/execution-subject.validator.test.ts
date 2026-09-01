import { describe, expect, it } from "vitest";

import { ___ExecutionSubjectSchema, ___ParseExecutionSubject } from "../execution-subject.validator";
import type { ExecutionSubjectVerificationContext } from "../execution-subject.validator.types";

/** Creates a current authority snapshot for one accepted execution subject. */
function _Current(): ExecutionSubjectVerificationContext
{
	return {
		siloId: "silo-1",
		agentIdentityId: "identity-1",
		principalId: "principal-agent-1",
		identityHeadRevision: "8",
		identityHeadDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		identityDecisionEvidenceId: "identity-decision-1",
		identityVerifiedAt: "2026-09-01T00:00:00.000Z",
		membershipRevision: 21,
		membershipAssertionId: "membership-assertion-1",
		membershipPayloadDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		membershipDecisionEvidenceId: "membership-decision-1",
		membershipTrustedUntil: "2026-09-01T01:00:00.000Z",
		capabilitySetDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
		effectiveContractDigest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
		capabilityDecisionEvidenceId: "capability-decision-1",
		capabilityDecidedAt: "2026-09-01T00:00:00.000Z",
		runId: "run-1",
		attempt: 2,
		agentServiceId: "agent-service-1",
		agentRevisionId: "agent-revision-1",
		computerId: "computer-1",
		computerLeaseId: "lease-1",
		computerLeaseGeneration: 4,
		nowEpochMilliseconds: Date.parse("2026-09-01T00:30:00.000Z"),
		requesterPrincipalId: "principal-requester-1",
		requestIdempotencyKey: "request-1",
		requesterAuthenticatedAt: "2026-09-01T00:00:00.000Z",
		authorizingPrincipalId: "principal-authorizer-1",
		admissionDecisionEvidenceId: "admission-decision-1",
		admissionAdmittedAt: "2026-09-01T00:00:00.000Z",
	};
}

/** Creates one complete execution subject with separate requester and admission authority. */
function _Subject(): Record<string, unknown>
{
	return {
		schemaVersion: 1,
		siloId: "silo-1",
		agentIdentityId: "identity-1",
		principalId: "principal-agent-1",
		identity: { agentIdentityId: "identity-1", principalId: "principal-agent-1", siloId: "silo-1", headRevision: "8", headDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", decisionEvidenceId: "identity-decision-1", verifiedAt: "2026-09-01T00:00:00.000Z" },
		membership: { principalId: "principal-agent-1", siloId: "silo-1", revision: 21, assertionId: "membership-assertion-1", payloadDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", decisionEvidenceId: "membership-decision-1", trustedUntil: "2026-09-01T01:00:00.000Z" },
		capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", effectiveContractDigest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", decisionEvidenceId: "capability-decision-1", decidedAt: "2026-09-01T00:00:00.000Z" },
		runScope: { siloId: "silo-1", runId: "run-1", attempt: 2, agentServiceId: "agent-service-1", agentRevisionId: "agent-revision-1" },
		computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 4 },
		requester: { siloId: "silo-1", requesterPrincipalId: "principal-requester-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-09-01T00:00:00.000Z" },
		admission: { authorizingPrincipalId: "principal-authorizer-1", decisionEvidenceId: "admission-decision-1", admittedAt: "2026-09-01T00:00:00.000Z" },
	};
}

describe("execution subject validator", function _DescribeExecutionSubjectValidator()
{
	it("preserves requester provenance separately from the principal that authorized execution", function _PreservesRequesterAuthorityBoundary()
	{
		const parsed = ___ParseExecutionSubject(_Subject(), _Current());
		expect(parsed?.requester.requesterPrincipalId).toBe("principal-requester-1");
		expect(parsed?.admission.authorizingPrincipalId).toBe("principal-authorizer-1");
	});

	it("rejects the retired kind branch and agent-service principal sentinel", function _RejectsRetiredIdentityEncoding()
	{
		expect(___ExecutionSubjectSchema.safeParse({ ..._Subject(), kind: "service" }).success).toBe(false);
		expect(___ExecutionSubjectSchema.safeParse({ ..._Subject(), principalId: "agent-service:agent-service-1" }).success).toBe(false);
	});

	it("rejects evidence from another silo or when required evidence is missing", function _RejectsCrossSiloOrIncompleteEvidence()
	{
		const wrongSilo = { ..._Subject(), membership: { ..._Subject().membership as Record<string, unknown>, siloId: "silo-2" } };
		const missingCapability = { ..._Subject() };
		delete missingCapability.capability;
		expect(___ParseExecutionSubject(wrongSilo, _Current())).toBeNull();
		expect(___ExecutionSubjectSchema.safeParse(missingCapability).success).toBe(false);
	});

	it("rejects a stale identity head even when the wire shape is otherwise valid", function _RejectsStaleIdentityHead()
	{
		const stale = { ..._Subject(), identity: { ..._Subject().identity as Record<string, unknown>, headRevision: "7" } };
		expect(___ExecutionSubjectSchema.safeParse(stale).success).toBe(true);
		expect(___ParseExecutionSubject(stale, _Current())).toBeNull();
	});

	it("accepts Kurrent's first zero-based identity-head revision", function _AcceptsFirstKurrentIdentityHead()
	{
		const firstHead = { ..._Subject(), identity: { ..._Subject().identity as Record<string, unknown>, headRevision: "0" } };
		const current = { ..._Current(), identityHeadRevision: "0" };
		expect(___ParseExecutionSubject(firstHead, current)?.identity.headRevision).toBe("0");
	});

	it("rejects a membership assertion after its trusted expiry", function _RejectsExpiredMembership()
	{
		const expired = { ..._Current(), nowEpochMilliseconds: Date.parse("2026-09-01T01:00:00.000Z") };
		expect(___ParseExecutionSubject(_Subject(), expired)).toBeNull();
	});

	it("rejects tampered evidence, run scope, and admission provenance", function _RejectsTamperedAuthorityBindings()
	{
		const capability = { ..._Subject(), capability: { ..._Subject().capability as Record<string, unknown>, effectiveContractDigest: `sha256:${"e".repeat(64)}` } };
		const run = { ..._Subject(), runScope: { ..._Subject().runScope as Record<string, unknown>, agentRevisionId: "agent-revision-2" } };
		const admission = { ..._Subject(), admission: { ..._Subject().admission as Record<string, unknown>, decisionEvidenceId: "admission-decision-2" } };
		expect(___ParseExecutionSubject(capability, _Current())).toBeNull();
		expect(___ParseExecutionSubject(run, _Current())).toBeNull();
		expect(___ParseExecutionSubject(admission, _Current())).toBeNull();
	});
});
