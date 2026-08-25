import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationGrantEffects, AuthorizationSubjectKinds } from "@opencrane/models/authorization";
import type { AuthorizationBoundary, AuthorizationBoundaryContext, AuthorizationGrant, AuthorizationSubject, CapabilityReference } from "@opencrane/models/authorization";
import { describe, expect, it } from "vitest";

import { __ResolveEffectiveAccess } from "../effective-access";
import type { AuthorizationGrantRepository, AuthorizationMembershipAuthority, AuthorizationMembershipDecision, AuthorizationMembershipRequirement, ResolveEffectiveAccessCommand } from "../effective-access.types";

/** Creates one immutable capability reference. */
function _capability(capabilityId: string): CapabilityReference
{
	return { catalog: { catalogId: "catalog-1", revision: 1, digest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" }, capabilityId };
}

/** Creates one exact group-boundary grant fixture. */
function _grant(grantId: string, principalId: string, capability: CapabilityReference): AuthorizationGrant
{
	return {
		grantId,
		siloId: "silo-1",
		subject: { kind: AuthorizationSubjectKinds.Principal, principalId },
		boundary: { kind: AuthorizationBoundaryKinds.Group, groupId: "project-1" },
		boundaryCoverage: AuthorizationBoundaryCoverages.Exact,
		capability,
		resource: { kind: "artifact", id: "artifact-1" },
		effect: AuthorizationGrantEffects.Allow,
		priority: 10,
		validFromEpochMs: 500,
		expiresAtEpochMs: 1500,
		revokedAtEpochMs: null,
	};
}

/** Creates a complete effective-access command fixture. */
function _command(capabilities: readonly CapabilityReference[]): ResolveEffectiveAccessCommand
{
	return {
		membership: { trustedIssuerId: "fleet-1", siloId: "silo-1", subjectId: "user-1", assertionId: "assertion-1", nowEpochMs: 1000, maximumStalenessMs: 3000 },
		actorSubjectId: "user-1",
		agentServiceSubjectId: "agent-service-1",
		boundary: { kind: AuthorizationBoundaryKinds.Group, groupId: "project-1" },
		resource: { kind: "artifact", id: "artifact-1" },
		capabilities,
		agentRevisionCapabilityCeiling: capabilities,
		runCapabilitySet: capabilities,
	};
}

/** Signed-membership port fixture with a configurable decision. */
class _MembershipAuthority implements AuthorizationMembershipAuthority
{
	/** Decision returned for every exact membership request. */
	private readonly decision: AuthorizationMembershipDecision;

	/** Creates a membership authority around one decision. */
	constructor(decision: AuthorizationMembershipDecision) { this.decision = decision; }

	/** Returns the configured signed-membership decision. */
	async verifyCurrentMembership(_requirement: AuthorizationMembershipRequirement): Promise<AuthorizationMembershipDecision> { return this.decision; }
}

/** In-memory authority context keyed by exact principals. */
class _GrantRepository implements AuthorizationGrantRepository
{
	/** Candidate grants available to deterministic evaluation. */
	private readonly grants: readonly AuthorizationGrant[];

	/** Creates a grant repository around candidate fixtures. */
	constructor(grants: readonly AuthorizationGrant[]) { this.grants = grants; }

	/** Resolves one principal without adding group membership in this fixture. */
	async resolvePrincipalSubjects(_siloId: string, principalId: string): Promise<readonly AuthorizationSubject[]> { return [{ kind: AuthorizationSubjectKinds.Principal, principalId }]; }

	/** Returns the fixed empty ancestor path for the exact fixture boundary. */
	async resolveBoundaryContext(_siloId: string, _boundary: AuthorizationBoundary): Promise<AuthorizationBoundaryContext> { return { requestedGroupAncestorIds: [] }; }

	/** Lists only grants belonging to the resolved subject set. */
	async listSubjectGrants(siloId: string, subjects: readonly AuthorizationSubject[]): Promise<readonly AuthorizationGrant[]>
	{
		const principalIds = new Set(subjects.filter(subject => subject.kind === AuthorizationSubjectKinds.Principal).map(subject => subject.principalId));
		return this.grants.filter(grant => grant.siloId === siloId && grant.subject.kind === AuthorizationSubjectKinds.Principal && principalIds.has(grant.subject.principalId));
	}
}

describe("effective access facade", function _suite()
{
	it("returns the capability allowed to both actor and agent service", async function _intersection()
	{
		const first = _capability("a.read");
		const second = _capability("b.write");
		const grants = [_grant("actor-a", "user-1", first), _grant("actor-b", "user-1", second), _grant("agent-a", "agent-service-1", first)];
		const result = await __ResolveEffectiveAccess(new _MembershipAuthority({ outcome: "trusted", revision: 9, trustedUntilEpochMs: 2000 }), new _GrantRepository(grants), _command([second, first, first]));
		expect(result.outcome).toBe("allowed");
		if (result.outcome === "allowed") expect(result.capabilities.map(capability => capability.capabilityId)).toEqual(["a.read"]);
	});

	it("fails closed when signed membership is stale", async function _staleMembership()
	{
		const result = await __ResolveEffectiveAccess(new _MembershipAuthority({ outcome: "trusted", revision: 9, trustedUntilEpochMs: 1000 }), new _GrantRepository([]), _command([_capability("a.read")]));
		expect(result).toEqual({ outcome: "denied", reason: "membership_stale", evidence: [] });
	});

	it("rejects membership bound to another actor before grant reads", async function _membershipBinding()
	{
		const command = _command([_capability("a.read")]);
		const result = await __ResolveEffectiveAccess(new _MembershipAuthority({ outcome: "trusted", revision: 9, trustedUntilEpochMs: 2000 }), new _GrantRepository([]), { ...command, membership: { ...command.membership, subjectId: "other" } });
		expect(result).toEqual({ outcome: "denied", reason: "invalid_command", evidence: [] });
	});

	it("denies capabilities outside the immutable revision ceiling", async function _ceiling()
	{
		const capability = _capability("artifact.write");
		const command = { ..._command([capability]), agentRevisionCapabilityCeiling: [_capability("artifact.read")] };
		const result = await __ResolveEffectiveAccess(new _MembershipAuthority({ outcome: "trusted", revision: 9, trustedUntilEpochMs: 2000 }), new _GrantRepository([]), command);
		expect(result).toEqual({ outcome: "denied", reason: "outside_revision_ceiling", evidence: [] });
	});
});
