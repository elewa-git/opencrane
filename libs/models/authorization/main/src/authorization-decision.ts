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
 * Determines whether a grant's silo, subject, capability, resource, and scope all match a
 * request. Time and priority are checked separately, later.
 * @param grant - Candidate authorization grant.
 * @param request - Authorization request being evaluated.
 * @returns True only when all five match; scope match allows a broader granted scope to cover a narrower request.
 */
function _grantApplies(grant: AuthorizationGrant, request: AuthorizationRequest): boolean
{
	return grant.siloId === request.siloId
		&& grant.subjectId === request.subjectId
		&& _capabilitiesEqual(grant.capability, request.capability)
		&& __AuthorizationResourcesEqual(grant.resource, request.resource)
		&& __AuthorizationScopeCovers(grant.scope, request.scope);
}

/** Returns whether a grant's validity times make sense: a non-negative start, an expiry after the start, and a revocation not before the start. */
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
 * Decide whether one request is allowed, given the grants that might apply.
 *
 * Order of resolution: keep the grants whose silo, subject, capability, resource, and scope match;
 * drop the ones not in force right now; take only those at the highest `priority`; and if any of
 * those says deny, the answer is deny. A higher priority completely replaces a lower one — it does
 * not add to it.
 *
 * Fails closed. No matching grant, a malformed time, a malformed priority, or a malformed request
 * clock all produce a deny, never an allow. The same inputs always give the same answer, so a
 * decision can be re-derived from an audit record.
 *
 * Called by: `libs/backend/server/iam/authorization/main/src/effective-access.ts`,
 * `libs/backend/server/iam/grants/main/src/routes/shares.ts`.
 * @param request - The action being attempted, including the caller's trusted current time.
 * @param grants - Every grant that might apply; unrelated grants are safe to include.
 * @returns The outcome, a stable `reason` for audit, and the grant ids that decided it — including the offending ids when the deny was caused by malformed data.
 * @see {@link AuthorizationDecisionReason}
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

	// 2. Keep only grants whose silo, subject, capability, resource, and scope match the request.
	const matchingGrants = grants.filter(grant => _grantApplies(grant, request));

	// 3. An absent grant always denies because authorization is fail closed.
	if (matchingGrants.length === 0)
	{
		return { outcome: AuthorizationDecisionOutcomes.Deny, reason: "no_matching_grant", grantIds: [] };
	}

	// 4. If any matching grant has malformed validity times, deny — the whole matching set is suspect.
	const invalidValidityGrants = matchingGrants.filter(grant => !_grantValidityIsWellFormed(grant));
	if (invalidValidityGrants.length > 0)
	{
		return {
			outcome: AuthorizationDecisionOutcomes.Deny,
			reason: "invalid_grant_validity",
			grantIds: invalidValidityGrants.map(grant => grant.grantId),
		};
	}

	// 5. A grant with a malformed priority cannot be ordered against the others, so deny.
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
