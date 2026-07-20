import type { AuthorizationGrant, CapabilityReference } from "@opencrane/models/authorization";
import { describe, expect, it } from "vitest";

import { __ResolveEffectiveAccess } from "../effective-access.js";
import type { AuthorizationGrantRepository, AuthorizationMembershipAuthority, AuthorizationMembershipDecision, AuthorizationMembershipRequirement, ResolveEffectiveAccessCommand } from "../effective-access.types.js";

/** Creates one immutable capability reference. */
function _capability(capabilityId: string): CapabilityReference
{
	return { catalog: { catalogId: "catalog-1", revision: 1, digest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" }, capabilityId };
}

/** Creates one exact project-scoped grant fixture. */
function _grant(grantId: string, subjectId: string, capability: CapabilityReference, effect: "allow" | "deny" = "allow"): AuthorizationGrant
{
	return {
		grantId,
		siloId: "silo-1",
		subjectId,
		scope: { kind: "project", organizationId: "org-1", projectId: "project-1" },
		capability,
		resource: { kind: "artifact", id: "artifact-1" },
		effect,
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
		membership: {
			trustedIssuerId: "fleet-1",
			siloId: "silo-1",
			subjectId: "user-1",
			assertionId: "assertion-1",
			scope: { kind: "project", organizationId: "org-1", projectId: "project-1" },
			nowEpochMs: 1000,
			maximumStalenessMs: 3000,
		},
		actorSubjectId: "user-1",
		agentServiceSubjectId: "agent-service-1",
		scope: { kind: "project", organizationId: "org-1", projectId: "project-1" },
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
	constructor(decision: AuthorizationMembershipDecision)
	{
		this.decision = decision;
	}

	/** Returns the configured signed-membership decision. */
	async verifyCurrentMembership(_requirement: AuthorizationMembershipRequirement): Promise<AuthorizationMembershipDecision>
	{
		return this.decision;
	}
}

/** In-memory grant query port keyed by exact subject. */
class _GrantRepository implements AuthorizationGrantRepository
{
	/** Candidate grants available to deterministic evaluation. */
	private readonly grants: readonly AuthorizationGrant[];

	/** Creates a grant repository around candidate fixtures. */
	constructor(grants: readonly AuthorizationGrant[])
	{
		this.grants = grants;
	}

	/** Lists only grants belonging to the requested silo and subject. */
	async listSubjectGrants(siloId: string, subjectId: string): Promise<readonly AuthorizationGrant[]>
	{
		return this.grants.filter(grant => grant.siloId === siloId && grant.subjectId === subjectId);
	}
}

describe("effective access facade", function _suite()
{
	it("returns a deterministic capability intersection across actor and AgentService", async function _intersection()
	{
		const first = _capability("a.read");
		const second = _capability("b.write");
		const grants = [
			_grant("actor-a", "user-1", first),
			_grant("actor-b", "user-1", second),
			_grant("agent-a", "agent-service-1", first),
		];
		const result = await __ResolveEffectiveAccess(new _MembershipAuthority({ outcome: "trusted", revision: 9, trustedUntilEpochMs: 2000 }), new _GrantRepository(grants), _command([second, first, first]));

		expect(result.outcome).toBe("allowed");
		if (result.outcome === "allowed")
		{
			expect(result.capabilities.map(capability => capability.capabilityId)).toEqual(["a.read"]);
			expect(result.evidence.map(item => item.capability.capabilityId)).toEqual(["a.read", "b.write"]);
		}
	});

	it("fails closed when membership trust has reached its freshness boundary", async function _staleMembership()
	{
		const result = await __ResolveEffectiveAccess(new _MembershipAuthority({ outcome: "trusted", revision: 9, trustedUntilEpochMs: 1000 }), new _GrantRepository([]), _command([_capability("a.read")]));

		expect(result).toEqual({ outcome: "denied", reason: "membership_stale", evidence: [] });
	});

	it("rejects membership for a different actor or independent scope before grant evaluation", async function _membershipBinding()
	{
		const membership = new _MembershipAuthority({ outcome: "trusted", revision: 9, trustedUntilEpochMs: 2000 });
		const repository = new _GrantRepository([]);
		const command = _command([_capability("a.read")]);

		expect(await __ResolveEffectiveAccess(membership, repository, { ...command, membership: { ...command.membership, subjectId: "user-other" } })).toEqual({ outcome: "denied", reason: "invalid_command", evidence: [] });
		expect(await __ResolveEffectiveAccess(membership, repository, { ...command, scope: { kind: "project", organizationId: "org-1", projectId: "project-other" } })).toEqual({ outcome: "denied", reason: "invalid_command", evidence: [] });
	});

	it("denies grant-allowed capabilities outside the immutable AgentRevision ceiling", async function _revisionCeiling()
	{
		const capability = _capability("artifact.write");
		const grants = [_grant("actor", "user-1", capability), _grant("agent", "agent-service-1", capability)];
		const command = { ..._command([capability]), agentRevisionCapabilityCeiling: [_capability("artifact.read")] };

		const result = await __ResolveEffectiveAccess(new _MembershipAuthority({ outcome: "trusted", revision: 9, trustedUntilEpochMs: 2000 }), new _GrantRepository(grants), command);

		expect(result).toEqual({ outcome: "denied", reason: "outside_revision_ceiling", evidence: [] });
	});

	it("denies grant-allowed capabilities outside the immutable run capability set", async function _runCeiling()
	{
		const capability = _capability("artifact.write");
		const grants = [_grant("actor", "user-1", capability), _grant("agent", "agent-service-1", capability)];
		const command = { ..._command([capability]), runCapabilitySet: [_capability("artifact.read")] };

		const result = await __ResolveEffectiveAccess(new _MembershipAuthority({ outcome: "trusted", revision: 9, trustedUntilEpochMs: 2000 }), new _GrantRepository(grants), command);

		expect(result).toEqual({ outcome: "denied", reason: "outside_run_capability_set", evidence: [] });
	});

	it("uses trusted membership time to exclude expired and revoked grants", async function _grantValidity()
	{
		const capability = _capability("artifact.read");
		const actorGrant = _grant("actor", "user-1", capability);
		const expiredServiceGrant = _grant("agent", "agent-service-1", capability);
		const grants = [actorGrant, { ...expiredServiceGrant, expiresAtEpochMs: 1000 }];

		const result = await __ResolveEffectiveAccess(new _MembershipAuthority({ outcome: "trusted", revision: 9, trustedUntilEpochMs: 2000 }), new _GrantRepository(grants), _command([capability]));

		expect(result.outcome).toBe("denied");
		if (result.outcome === "denied") expect(result.reason).toBe("empty_intersection");
	});
});
