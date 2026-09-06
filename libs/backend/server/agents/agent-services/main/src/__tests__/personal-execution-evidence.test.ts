import { AgentIdentityStates } from "@opencrane/contracts";
import { RevisionBoundaryCoverages, RevisionBoundaryKinds } from "@opencrane/models/agents";
import { AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";
import { describe, expect, it, vi } from "vitest";

import { PersonalExecutionEvidenceAuthority } from "../personal-execution-evidence";
import { PersonalExecutionEvidenceDenialReasons } from "../personal-execution-evidence.types";

/** Stable active proxied identity supplied by the checked Kurrent identity-history authority. */
const _IDENTITY = { schemaVersion: 1, id: "identity-1", siloId: "silo-1", agentServiceId: "service-1", name: "Personal agent", avatarArtifactRevisionId: null, state: AgentIdentityStates.Active, createdByPrincipalId: "principal-1", createdAt: "2026-09-01T00:00:00.000Z", kind: "proxied", proxiedPrincipalId: "principal-1", delegationPolicyId: "personal-agent-session-v1" } as const;

/** Builds a current personal revision with intentionally unsorted effective inputs. */
function _Revision()
{
	return { id: "revision-1", digest: `sha256:${"a".repeat(64)}`, modelDefinitionId: "model-1", budget: { maximumTurns: 8 }, boundaryAttachments: [{ boundaryKind: RevisionBoundaryKinds.Personal, boundaryId: "principal-1", boundaryCoverage: RevisionBoundaryCoverages.Exact }], skillAssignments: [{ skillId: "skill-z", skillRevisionId: "revision-z" }, { skillId: "skill-a", skillRevisionId: "revision-a" }], mcpToolRevisionIds: ["tool-z", "tool-a"] };
}

/** Builds narrow repository and central-authority spies around current evidence. */
function _Dependencies(revision: ReturnType<typeof _Revision> | null = _Revision())
{
	const membership = { issuerId: "fleet-1", issuerKeyId: "key-1", revision: 7, assertionId: "assertion-1", subjectId: "principal-1", payloadDigest: "sha256:membership", trustedUntilEpochMs: 12_000 };
	const repository = { loadActiveRevision: vi.fn().mockResolvedValue(revision), verifyCurrentMembership: vi.fn().mockResolvedValue(membership) };
	const evidence = { decisionDigest: `sha256:${"b".repeat(64)}`, policyRevisionHash: `sha256:${"c".repeat(64)}`, effectiveAuthorizationDigest: `sha256:${"d".repeat(64)}` };
	const authorization = { admitPrincipal: vi.fn().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, evidence }), admit: vi.fn().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { ...evidence, decisionDigest: `sha256:${"e".repeat(64)}` } }) };
	return { repository, authorization };
}

describe("PersonalExecutionEvidenceAuthority", function _Suite()
{
	it("denies a mismatched or suspended identity before reading authority state", async function _RejectsIdentity()
	{
		for (const identity of [{ ..._IDENTITY, proxiedPrincipalId: "principal-other" }, { ..._IDENTITY, state: AgentIdentityStates.Suspended }])
		{
			const dependencies = _Dependencies();
			const authority = new PersonalExecutionEvidenceAuthority(dependencies.repository);
			await expect(authority.load({ identity, requesterPrincipalId: "principal-1", agentRevisionId: "revision-1" }, { authorization: dependencies.authorization as never, admittedAtEpochMs: 2_000 })).resolves.toEqual({ outcome: "denied", reason: PersonalExecutionEvidenceDenialReasons.IdentityUnavailable });
			expect(dependencies.repository.loadActiveRevision).not.toHaveBeenCalled();
		}
	});

	it("requires an active revision and current signed membership", async function _RejectsMissingEvidence()
	{
		const inactive = _Dependencies(null);
		const inactiveAuthority = new PersonalExecutionEvidenceAuthority(inactive.repository);
		await expect(inactiveAuthority.load({ identity: _IDENTITY, requesterPrincipalId: "principal-1", agentRevisionId: "revision-1" }, { authorization: inactive.authorization as never, admittedAtEpochMs: 2_000 })).resolves.toEqual({ outcome: "denied", reason: PersonalExecutionEvidenceDenialReasons.RunNotAdmittable });
		const stale = _Dependencies();
		stale.repository.verifyCurrentMembership.mockResolvedValue(null);
		const staleAuthority = new PersonalExecutionEvidenceAuthority(stale.repository);
		await expect(staleAuthority.load({ identity: _IDENTITY, requesterPrincipalId: "principal-1", agentRevisionId: "revision-1" }, { authorization: stale.authorization as never, admittedAtEpochMs: 2_000 })).resolves.toEqual({ outcome: "denied", reason: PersonalExecutionEvidenceDenialReasons.MembershipStale });
	});

	it("denies any refused boundary decision", async function _RejectsBoundary()
	{
		const dependencies = _Dependencies();
		dependencies.authorization.admit.mockResolvedValue({ outcome: "deny", evidence: null } as never);
		const authority = new PersonalExecutionEvidenceAuthority(dependencies.repository);
		await expect(authority.load({ identity: _IDENTITY, requesterPrincipalId: "principal-1", agentRevisionId: "revision-1" }, { authorization: dependencies.authorization as never, admittedAtEpochMs: 2_000 })).resolves.toEqual({ outcome: "denied", reason: PersonalExecutionEvidenceDenialReasons.CapabilityUnavailable });
	});

	it("returns membership, Invoke, boundary, and effective-contract evidence", async function _LoadsEvidence()
	{
		const dependencies = _Dependencies();
		const authority = new PersonalExecutionEvidenceAuthority(dependencies.repository);
		const result = await authority.load({ identity: _IDENTITY, requesterPrincipalId: "principal-1", agentRevisionId: "revision-1" }, { authorization: dependencies.authorization as never, admittedAtEpochMs: 2_000 });
		expect(result).toMatchObject({ outcome: "loaded", value: { identity: { agentIdentityId: "identity-1", principalId: "principal-1", agentRevisionId: "revision-1" }, membership: { assertionId: "assertion-1", revision: 7 }, capability: { authorizationDecisionDigests: [`sha256:${"b".repeat(64)}`, `sha256:${"e".repeat(64)}`] }, admissionDecisionDigest: `sha256:${"b".repeat(64)}` } });
		expect(dependencies.authorization.admitPrincipal).toHaveBeenCalledTimes(1);
		expect(dependencies.authorization.admit).toHaveBeenCalledTimes(1);
	});
});
