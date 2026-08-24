import { __DecideAuthorization, __IsAuthorizationResourceLocator } from "@opencrane/models/authorization";
import { AuthorizationDecisionOutcomes, AuthorizationBoundaryKinds } from "@opencrane/models/authorization";

import type { AuthorizationContextRepository, ResolvePrincipalAuthorizationCommand, ResolvePrincipalAuthorizationResult } from "./authorization-resolution.types";

/**
 * Resolves and evaluates authorization for one authenticated local principal.
 *
 * The caller supplies no group ids or hierarchy path. This function resolves both from product
 * authority, which prevents login claims and request fields from manufacturing grant coverage.
 *
 * Called by: MCP catalogue/install authorization and other product adapters that enforce generic grants.
 * @param repository - Product-authority reader for principals, direct memberships, grants, and group ancestry.
 * @param command - Principal, boundary, capability, resource, and trusted time to evaluate.
 * @returns A deterministic allow or deny decision with winning grant evidence.
 */
export async function __ResolvePrincipalAuthorization(
	repository: AuthorizationContextRepository,
	command: ResolvePrincipalAuthorizationCommand,
): Promise<ResolvePrincipalAuthorizationResult>
{
	// 1. Reject malformed authority coordinates before any database read.
	if (!command.siloId.trim()
		|| !command.principalId.trim()
		|| !__IsAuthorizationResourceLocator(command.resource)
		|| !Number.isSafeInteger(command.nowEpochMs)
		|| command.nowEpochMs < 0
		|| (command.boundary.kind === AuthorizationBoundaryKinds.Personal
			&& command.boundary.principalId !== command.principalId))
	{
		return { outcome: AuthorizationDecisionOutcomes.Deny, reason: "no_matching_grant", grantIds: [] };
	}

	// 2. Resolve direct memberships and the stored group path so request data cannot expand authority.
	const [subjects, boundaryContext] = await Promise.all([
		repository.resolvePrincipalSubjects(command.siloId, command.principalId),
		repository.resolveBoundaryContext(command.siloId, command.boundary),
	]);
	if (subjects.length === 0)
	{
		return { outcome: AuthorizationDecisionOutcomes.Deny, reason: "no_matching_grant", grantIds: [] };
	}

	// 3. Read grants for the resolved identities and let the pure domain policy decide the winner.
	const grants = await repository.listSubjectGrants(command.siloId, subjects);
	return __DecideAuthorization({
		siloId: command.siloId,
		subjects,
		boundary: command.boundary,
		capability: command.capability,
		resource: command.resource,
		nowEpochMs: command.nowEpochMs,
	}, grants, boundaryContext);
}
