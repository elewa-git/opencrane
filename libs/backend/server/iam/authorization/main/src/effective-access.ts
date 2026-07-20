import { __AuthorizationScopesEqual, __DecideAuthorization, __IsAuthorizationResourceLocator } from "@opencrane/models/authorization";
import type { AuthorizationGrant, AuthorizationRequest, CapabilityReference } from "@opencrane/models/authorization";

import type { AuthorizationGrantRepository, AuthorizationMembershipAuthority, EffectiveCapabilityEvidence, ResolveEffectiveAccessCommand, ResolveEffectiveAccessResult } from "./effective-access.types.js";

/** Produces a stable lexical key for an immutable capability reference. */
function _capabilityKey(capability: CapabilityReference): string
{
	return `${capability.catalog.catalogId}\u0000${capability.catalog.revision}\u0000${capability.catalog.digest}\u0000${capability.capabilityId}`;
}

/** Returns whether an immutable capability reference is structurally valid. */
function _capabilityIsValid(capability: CapabilityReference): boolean
{
	return capability.capabilityId.trim().length > 0
		&& capability.catalog.catalogId.trim().length > 0
		&& Number.isSafeInteger(capability.catalog.revision)
		&& capability.catalog.revision > 0
		&& /^sha256:[0-9a-f]{64}$/u.test(capability.catalog.digest);
}

/** Returns unique capability references in deterministic lexical order. */
function _orderedUniqueCapabilities(capabilities: readonly CapabilityReference[]): CapabilityReference[]
{
	const unique = new Map<string, CapabilityReference>();
	for (const capability of capabilities)
	{
		unique.set(_capabilityKey(capability), capability);
	}
	return [...unique.entries()].sort(function _compare(left, right) { return left[0].localeCompare(right[0]); }).map(entry => entry[1]);
}

/** Evaluates one side of the effective-access intersection. */
function _decideForSubject(command: ResolveEffectiveAccessCommand, subjectId: string, capability: CapabilityReference, grants: readonly AuthorizationGrant[])
{
	const request: AuthorizationRequest = { siloId: command.membership.siloId, subjectId, scope: command.scope, capability, resource: command.resource, nowEpochMs: command.membership.nowEpochMs };
	return __DecideAuthorization(request, grants);
}

/**
 * Resolves effective access as the deterministic intersection of actor and AgentService grants.
 * Current signed membership is a mandatory first gate and may never be inferred from grants.
 * @param membershipAuthority - Signed fleet-membership authority port.
 * @param grantRepository - Candidate grant persistence port.
 * @param command - Actor, service, scope, membership, and capability request.
 * @returns Only capabilities independently allowed to both principals.
 */
export async function __ResolveEffectiveAccess(membershipAuthority: AuthorizationMembershipAuthority, grantRepository: AuthorizationGrantRepository, command: ResolveEffectiveAccessCommand): Promise<ResolveEffectiveAccessResult>
{
	// 1. Validate principal identities and capability input before any authority query.
	if (!command.actorSubjectId.trim()
		|| !command.agentServiceSubjectId.trim()
		|| command.actorSubjectId === command.agentServiceSubjectId
		|| command.membership.subjectId !== command.actorSubjectId
		|| !__AuthorizationScopesEqual(command.membership.scope, command.scope)
		|| !__IsAuthorizationResourceLocator(command.resource)
		|| !Number.isSafeInteger(command.membership.nowEpochMs)
		|| command.membership.nowEpochMs < 0
		|| !Number.isSafeInteger(command.membership.maximumStalenessMs)
		|| command.membership.maximumStalenessMs <= 0
		|| command.capabilities.length === 0
		|| command.capabilities.some(capability => !_capabilityIsValid(capability))
		|| command.agentRevisionCapabilityCeiling.some(capability => !_capabilityIsValid(capability))
		|| command.runCapabilitySet.some(capability => !_capabilityIsValid(capability)))
	{
		return { outcome: "denied", reason: "invalid_command", evidence: [] };
	}

	// 2. Require current signed membership and independently enforce its returned trust boundary.
	const membership = await membershipAuthority.verifyCurrentMembership(command.membership);
	if (membership.outcome !== "trusted")
	{
		return { outcome: "denied", reason: "membership_denied", membershipReason: membership.reason, evidence: [] };
	}
	if (!Number.isSafeInteger(membership.revision) || membership.revision < 1 || !Number.isSafeInteger(membership.trustedUntilEpochMs) || command.membership.nowEpochMs >= membership.trustedUntilEpochMs)
	{
		return { outcome: "denied", reason: "membership_stale", evidence: [] };
	}

	// 3. Intersect requested capabilities with immutable revision and run ceilings before grant reads.
	const requestedCapabilities = _orderedUniqueCapabilities(command.capabilities);
	const revisionCapabilityKeys = new Set(command.agentRevisionCapabilityCeiling.map(capability => _capabilityKey(capability)));
	const revisionCapabilities = requestedCapabilities.filter(capability => revisionCapabilityKeys.has(_capabilityKey(capability)));
	if (revisionCapabilities.length === 0)
	{
		return { outcome: "denied", reason: "outside_revision_ceiling", evidence: [] };
	}
	const runCapabilityKeys = new Set(command.runCapabilitySet.map(capability => _capabilityKey(capability)));
	const effectiveCandidates = revisionCapabilities.filter(capability => runCapabilityKeys.has(_capabilityKey(capability)));
	if (effectiveCandidates.length === 0)
	{
		return { outcome: "denied", reason: "outside_run_capability_set", evidence: [] };
	}

	// 4. Load each principal's grants independently so neither authority can expand the other.
	const [actorGrants, agentServiceGrants] = await Promise.all([
		grantRepository.listSubjectGrants(command.membership.siloId, command.actorSubjectId),
		grantRepository.listSubjectGrants(command.membership.siloId, command.agentServiceSubjectId),
	]);

	// 5. Evaluate the ceiling-bounded capability order and retain decisions from both principals.
	const evidence: EffectiveCapabilityEvidence[] = effectiveCandidates.map(function _evaluate(capability)
	{
		return {
			capability,
			actorDecision: _decideForSubject(command, command.actorSubjectId, capability, actorGrants),
			agentServiceDecision: _decideForSubject(command, command.agentServiceSubjectId, capability, agentServiceGrants),
		};
	});

	// 6. Intersect only dual allows; an empty grant intersection fails closed.
	const capabilities = evidence.filter(item => item.actorDecision.outcome === "allow" && item.agentServiceDecision.outcome === "allow").map(item => item.capability);
	if (capabilities.length === 0)
	{
		return { outcome: "denied", reason: "empty_intersection", evidence };
	}
	return { outcome: "allowed", fleetMembershipRevision: membership.revision, capabilities, evidence };
}
