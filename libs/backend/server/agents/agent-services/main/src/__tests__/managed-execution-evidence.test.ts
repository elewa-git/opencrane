import { AgentIdentityStates } from "@opencrane/contracts";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ExecutionSubjectMembershipKinds } from "@opencrane/models/agents";
import { describe, expect, it, vi } from "vitest";

import { ManagedExecutionEvidenceAuthority } from "../managed-execution-evidence";

const _IDENTITY = { schemaVersion: 1, kind: "managed", id: "company-identity", siloId: "silo-1", agentServiceId: "company-service", principalId: "company-principal", name: "Company assistant", avatarArtifactRevisionId: null, state: AgentIdentityStates.Active, createdByPrincipalId: "admin", createdAt: new Date(1_000).toISOString() } as const;

/** Supplies independent current company authority and human fleet evidence. */
function _Fixture()
{
	const revision = { agentServiceId: "company-service", agentRevisionId: "revision-1", agentRevisionDigest: "sha256:revision", principalId: "company-principal", name: "Company assistant", workloadProfile: "company", modelDefinitionId: "model-1", budget: { maxDurationMs: 10_000 } };
	const human = { kind: "fleet", principalId: "human-1", siloId: "silo-1", decisionEvidenceId: "human-assertion", revision: 7, assertionId: "human-assertion", payloadDigest: "sha256:human", trustedUntil: new Date(6_000).toISOString() };
	const repository = { loadCurrent: vi.fn().mockResolvedValue(revision), verifyRequesterMembership: vi.fn().mockResolvedValue(human) };
	const admitPrincipal = vi.fn().mockResolvedValueOnce({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { decisionDigest: "sha256:invoke" } }).mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { decisionDigest: "sha256:model" } });
	const command = { identity: _IDENTITY, requesterPrincipalId: "human-1", agentRevisionId: "revision-1" };
	const transaction = { authorization: { admitPrincipal }, admittedAtEpochMs: 2_000 };
	return { repository, revision, human, admitPrincipal, command, transaction, authority: new ManagedExecutionEvidenceAuthority(repository) };
}

describe("ManagedExecutionEvidenceAuthority", function _Suite()
{
	it("uses the company Principal for model use and caps its evidence at the separate human assertion expiry", async function _SeparatesAuthority()
	{
		const f = _Fixture();
		const result = await f.authority.load(f.command, f.transaction as never);
		expect(result).toMatchObject({ outcome: "loaded", value: { membership: { kind: ExecutionSubjectMembershipKinds.Managed, principalId: "company-principal", trustedUntil: new Date(6_000).toISOString(), agentRevisionDigest: "sha256:revision", decisionEvidenceId: "sha256:model" }, requesterMembership: { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "human-1", revision: 7 }, admissionDecisionDigest: "sha256:invoke" } });
		expect(f.repository.verifyRequesterMembership).toHaveBeenCalledExactlyOnceWith("silo-1", "human-1", 2_000);
		expect(f.admitPrincipal).toHaveBeenNthCalledWith(1, expect.objectContaining({ principalId: "human-1", action: ProductAuthorizationActions.Invoke, membershipRevision: 7 }));
		expect(f.admitPrincipal).toHaveBeenNthCalledWith(2, expect.objectContaining({ principalId: "company-principal", action: ProductAuthorizationActions.Use, resource: { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: "model-1" } }));
		expect(f.admitPrincipal.mock.calls[1]?.[0]).not.toHaveProperty("membershipRevision");
	});

	it.each([null, { agentRevisionId: "revision-2" }, { principalId: "other" }, { budget: [] }])("rejects changed current company authority %j before any grant admission", async function _RejectsCurrent(patch)
	{
		const f = _Fixture();
		f.repository.loadCurrent.mockResolvedValue(patch === null ? null : { ...f.revision, ...patch });
		expect(await f.authority.load(f.command, f.transaction as never)).toMatchObject({ outcome: "denied" });
		expect(f.admitPrincipal).not.toHaveBeenCalled();
	});

	it("cannot borrow requester membership when that human has been revoked", async function _RejectsHuman()
	{
		const f = _Fixture();
		f.repository.verifyRequesterMembership.mockResolvedValue(null);
		expect(await f.authority.load(f.command, f.transaction as never)).toEqual({ outcome: "denied", reason: "membership_stale" });
		expect(f.admitPrincipal).not.toHaveBeenCalled();
	});

	it.each([1, 2])("requires recorded current permission at decision %s", async function _RejectsGrant(index)
	{
		const f = _Fixture();
		f.admitPrincipal.mockReset().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Deny, evidence: null });
		if (index === 2)
			f.admitPrincipal.mockResolvedValueOnce({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { decisionDigest: "sha256:invoke" } });
		expect(await f.authority.load(f.command, f.transaction as never)).toEqual({ outcome: "denied", reason: "product_authorization_unavailable" });
		expect(f.admitPrincipal).toHaveBeenCalledTimes(index);
	});
});
