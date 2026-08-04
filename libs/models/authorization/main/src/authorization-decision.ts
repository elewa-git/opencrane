import type { CapabilityReference } from "./capability.types.js";
import { AuthorizationDecisionOutcomes, type AuthorizationDecision, type AuthorizationGrant, type AuthorizationRequest } from "./grant.types.js";
import { __AuthorizationResourcesEqual } from "./resource-locator.js";
import { __AuthorizationScopeCovers } from "./scope-matching.js";

/**
 * Compares immutable capability references.
 * @param firstCapability - First capability reference.
 * @param secondCapability - Second capability reference.
 * @returns Whether both references identify the exact catalog capability.
 */
function _capabilitiesEqual(
	firstCapability: CapabilityReference,
	secondCapability: CapabilityReference,
): boolean
{
	return firstCapability.capabilityId === secondCapability.capabilityId
		&& firstCapability.catalog.catalogId === secondCapability.catalog.catalogId
		&& firstCapability.catalog.revision === secondCapability.catalog.revision
		&& firstCapability.catalog.digest === secondCapability.catalog.digest;
}

/**
 * Determines whether a grant applies structurally to a request before priority evaluation.
 * @param grant - Candidate authorization grant.
 * @param request - Authorization request being evaluated.
 * @returns Whether the grant applies to the request.
 */
function _grantApplies(grant: AuthorizationGrant, request: AuthorizationRequest): boolean
{
	return grant.siloId === request.siloId
		&& grant.subjectId === request.subjectId
		&& _capabilitiesEqual(grant.capability, request.capability)
		&& __AuthorizationResourcesEqual(grant.resource, request.resource)
		&& __AuthorizationScopeCovers(grant.scope, request.scope);
}

/** Returns whether one structurally matching grant has well-formed validity boundaries. */
function _grantValidityIsWellFormed(grant: AuthorizationGrant): boolean
{
	return Number.isSafeInteger(grant.validFromEpochMs)
		&& grant.validFromEpochMs >= 0
		&& (grant.expiresAtEpochMs === null
			|| (Number.isSafeInteger(grant.expiresAtEpochMs) && grant.expiresAtEpochMs > grant.validFromEpochMs))
		&& (grant.revokedAtEpochMs === null
			|| (Number.isSafeInteger(grant.revokedAtEpochMs) && grant.revokedAtEpochMs >= grant.validFromEpochMs));
}

/** Returns whether a well-formed grant is active at the request's trusted current time. */
function _grantIsActive(grant: AuthorizationGrant, nowEpochMs: number): boolean
{
	return grant.validFromEpochMs <= nowEpochMs
		&& (grant.expiresAtEpochMs === null || nowEpochMs < grant.expiresAtEpochMs)
		&& grant.revokedAtEpochMs === null;
}

/**
 * Produces a deterministic fail-closed authorization decision.
 * Higher priorities replace lower priorities and deny wins whenever effects
 * conflict at the same highest priority.
 * @param request - Authorization request being evaluated.
 * @param grants - Candidate grants available to the evaluator.
 * @returns Deterministic authorization decision with winning evidence.
 */
export function __DecideAuthorization(
	request: AuthorizationRequest,
	grants: readonly AuthorizationGrant[],
): AuthorizationDecision
{
	// 1. Trusted time must be an exact non-negative integer before any grant can authorize.
	if (!Number.isSafeInteger(request.nowEpochMs) || request.nowEpochMs < 0)
	{
		return { outcome: AuthorizationDecisionOutcomes.Deny, reason: "invalid_request_time", grantIds: [] };
	}

	// 2. Structural matching excludes grants from other trust and scope boundaries.
	const matchingGrants = grants.filter(grant => _grantApplies(grant, request));

	// 3. An absent grant always denies because authorization is fail closed.
	if (matchingGrants.length === 0)
	{
		return { outcome: AuthorizationDecisionOutcomes.Deny, reason: "no_matching_grant", grantIds: [] };
	}

	// 4. Invalid validity metadata makes the matching authority set untrustworthy.
	const invalidValidityGrants = matchingGrants.filter(grant => !_grantValidityIsWellFormed(grant));
	if (invalidValidityGrants.length > 0)
	{
		return {
			outcome: AuthorizationDecisionOutcomes.Deny,
			reason: "invalid_grant_validity",
			grantIds: invalidValidityGrants.map(grant => grant.grantId),
		};
	}

	// 5. Invalid precedence cannot safely participate in ordering, so reject the request.
	const invalidPriorityGrants = matchingGrants.filter(grant => !Number.isSafeInteger(grant.priority) || grant.priority < 0);
	if (invalidPriorityGrants.length > 0)
	{
		return {
			outcome: AuthorizationDecisionOutcomes.Deny,
			reason: "invalid_grant_priority",
			grantIds: invalidPriorityGrants.map(grant => grant.grantId),
		};
	}

	// 6. Future, expired, and revoked grants cannot contribute authority.
	const activeGrants = matchingGrants.filter(grant => _grantIsActive(grant, request.nowEpochMs));
	if (activeGrants.length === 0)
	{
		return { outcome: AuthorizationDecisionOutcomes.Deny, reason: "no_matching_grant", grantIds: [] };
	}

	// 7. Only active grants at the highest priority may determine the final effect.
	const winningPriority = Math.max(...activeGrants.map(grant => grant.priority));
	const winningGrants = activeGrants.filter(grant => grant.priority === winningPriority);
	const denyWins = winningGrants.some(grant => grant.effect === "deny");

	return {
		outcome: denyWins ? AuthorizationDecisionOutcomes.Deny : AuthorizationDecisionOutcomes.Allow,
		reason: denyWins ? "winning_deny" : "winning_allow",
		grantIds: winningGrants.map(grant => grant.grantId),
		winningPriority,
	};
}
