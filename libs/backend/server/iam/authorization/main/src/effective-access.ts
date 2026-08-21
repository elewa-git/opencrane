import { __DecideAuthorization, __IsAuthorizationResourceLocator, AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";
import type { AuthorizationBoundaryContext, AuthorizationGrant, AuthorizationRequest, AuthorizationSubject, CapabilityReference } from "@opencrane/models/authorization";

import { AuthorizationMembershipOutcomes, type AuthorizationGrantRepository, type AuthorizationMembershipAuthority, type EffectiveCapabilityEvidence, type ResolveEffectiveAccessCommand, type ResolveEffectiveAccessResult } from "./effective-access.types";

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

/** Decides one capability for one subject against that subject's own grants. */
function _decideForSubjects(command: ResolveEffectiveAccessCommand, subjects: readonly AuthorizationSubject[], boundaryContext: AuthorizationBoundaryContext, capability: CapabilityReference, grants: readonly AuthorizationGrant[])
{
	const request: AuthorizationRequest = { siloId: command.membership.siloId, subjects, boundary: command.boundary, capability, resource: command.resource, nowEpochMs: command.membership.nowEpochMs };
	return __DecideAuthorization(request, grants, boundaryContext);
}

/**
 * Work out what an agent may do on a person's behalf, and nothing more.
 *
 * Runs in a fixed order, and the order is the security property:
 * 1. Validate the request. A person acting as their own agent, or a mismatched scope, is rejected
 *    before any query runs.
 * 2. Require a current signed membership — never inferred from grants — and independently re-check
 *    the expiry the membership authority returned.
 * 3. Narrow the requested capabilities to what the agent revision published and what this run
 *    compiled, before reading a single grant.
 * 4. Read each principal's grants separately, so neither side can widen the other.
 * 5. Keep only capabilities both sides allow. An empty result is a denial, never an empty allow.
 *
 * Called by: no caller in this repo yet — only its own tests in ./__tests__/effective-access.test.ts.
 * @param membershipAuthority - The mandatory first gate; see
 *   {@link AuthorizationMembershipAuthority}.
 * @param grantRepository - Reads candidate grants for one subject.
 * @param command - The person, the agent authority, the scope and resource, and the capabilities
 *   being requested.
 * @returns `allowed` with the surviving capabilities and the membership revision, or `denied` with
 *   the reason the request died. See {@link ResolveEffectiveAccessResult}.
 */
export async function __ResolveEffectiveAccess(membershipAuthority: AuthorizationMembershipAuthority, grantRepository: AuthorizationGrantRepository, command: ResolveEffectiveAccessCommand): Promise<ResolveEffectiveAccessResult>
{
	// 1. Validate principal identities and capability input before any authority query.
	if (!command.actorSubjectId.trim()
		|| !command.agentServiceSubjectId.trim()
		|| command.actorSubjectId === command.agentServiceSubjectId
		|| command.membership.subjectId !== command.actorSubjectId
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
	if (membership.outcome === AuthorizationMembershipOutcomes.Denied)
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

	// 4. Resolve each principal's direct groups and the requested boundary from product authority.
	const [actorSubjects, agentServiceSubjects, boundaryContext] = await Promise.all([
		grantRepository.resolvePrincipalSubjects(command.membership.siloId, command.actorSubjectId),
		grantRepository.resolvePrincipalSubjects(command.membership.siloId, command.agentServiceSubjectId),
		grantRepository.resolveBoundaryContext(command.membership.siloId, command.boundary),
	]);
	if (actorSubjects.length === 0 || agentServiceSubjects.length === 0)
	{
		return { outcome: "denied", reason: "empty_intersection", evidence: [] };
	}

	// 5. Load each resolved identity set independently so neither principal can widen the other.
	const [actorGrants, agentServiceGrants] = await Promise.all([
		grantRepository.listSubjectGrants(command.membership.siloId, actorSubjects),
		grantRepository.listSubjectGrants(command.membership.siloId, agentServiceSubjects),
	]);

	// 6. Evaluate the ceiling-bounded capability order and retain decisions from both principals.
	const evidence: EffectiveCapabilityEvidence[] = effectiveCandidates.map(function _evaluate(capability)
	{
		return {
			capability,
			actorDecision: _decideForSubjects(command, actorSubjects, boundaryContext, capability, actorGrants),
			agentServiceDecision: _decideForSubjects(command, agentServiceSubjects, boundaryContext, capability, agentServiceGrants),
		};
	});

	// 7. Intersect only dual allows; an empty grant intersection fails closed.
	const capabilities = evidence.filter(item => item.actorDecision.outcome === AuthorizationDecisionOutcomes.Allow && item.agentServiceDecision.outcome === AuthorizationDecisionOutcomes.Allow).map(item => item.capability);
	if (capabilities.length === 0)
	{
		return { outcome: "denied", reason: "empty_intersection", evidence };
	}
	return { outcome: "allowed", fleetMembershipRevision: membership.revision, capabilities, evidence };
}
