import type { RevisionScopeAttachment } from "@opencrane/models/agents";

import type { AttachAuthorityResult, EffectiveScopeGrant, ScopeAttachmentIntersection, ScopeGrantResolver } from "./scope-attachment-authority.types.js";

/** NUL-delimited canonical key for one scope triple, safe against concatenation aliasing. */
function _tripleKey(triple: { scope: string; subjectType: string; subjectId: string }): string
{
	return `${triple.scope}\u0000${triple.subjectType}\u0000${triple.subjectId}`;
}

/**
 * Intersect declared scope attachments against a set of effective allow grants.
 *
 * Pure: an attachment survives only when its exact `{ scope, subjectType, subjectId }` triple is
 * present among the effective grants. Because the grant set is allow-only, the intersection can
 * never grant access the principal does not already hold — a stored attachment is a filter over real
 * access, never a widening.
 *
 * @param attachments - Declared revision-scope attachments.
 * @param effectiveGrants - Allow-only effective knowledge-scope grants.
 * @returns The authorised (backed) and rejected (unbacked) attachment partition.
 */
export function __IntersectScopeAttachments(attachments: readonly RevisionScopeAttachment[], effectiveGrants: readonly EffectiveScopeGrant[]): ScopeAttachmentIntersection
{
	const allowed = new Set(effectiveGrants.map(_tripleKey));
	const authorized: RevisionScopeAttachment[] = [];
	const rejected: RevisionScopeAttachment[] = [];
	for (const attachment of attachments)
	{
		if (allowed.has(_tripleKey(attachment))) authorized.push(attachment);
		else rejected.push(attachment);
	}
	return { authorized, rejected };
}

/**
 * Resolve the RUNTIME effective scope access for a set of attachments.
 *
 * Compiles the agent's effective grants for its execution principals and intersects the attachments
 * against them, so the runtime is handed only the scopes the agent actually has effective access to
 * — a project-scoped agent gets its project attachment and nothing for a peer project, personal,
 * department, or org scope it was never granted.
 *
 * @param resolver - Effective-grant resolver.
 * @param principalIds - The agent's execution principals.
 * @param attachments - Declared revision-scope attachments.
 * @returns The authorised/rejected intersection.
 */
export async function __ResolveEffectiveScopeAttachments(resolver: ScopeGrantResolver, principalIds: readonly string[], attachments: readonly RevisionScopeAttachment[]): Promise<ScopeAttachmentIntersection>
{
	if (attachments.length === 0) return { authorized: [], rejected: [] };
	const effectiveGrants = await resolver.resolveEffectiveScopeGrants(principalIds);
	return __IntersectScopeAttachments(attachments, effectiveGrants);
}

/**
 * Validate at AUTHORING time that a caller administers every scope they attach.
 *
 * Compiles the caller's own effective grants and requires each declared attachment to be backed by
 * one, so an administrator cannot attach a scope they do not themselves hold. Any unbacked
 * attachment fails closed with the exact offending triples, which the router maps to a 403.
 *
 * @param resolver - Effective-grant resolver.
 * @param callerPrincipalIds - The attaching caller's principals.
 * @param attachments - Declared revision-scope attachments.
 * @returns Authorised, or unauthorised with the offending attachments.
 */
export async function __ValidateAttachAuthority(resolver: ScopeGrantResolver, callerPrincipalIds: readonly string[], attachments: readonly RevisionScopeAttachment[]): Promise<AttachAuthorityResult>
{
	if (attachments.length === 0) return { outcome: "authorized" };
	const intersection = await __ResolveEffectiveScopeAttachments(resolver, callerPrincipalIds, attachments);
	if (intersection.rejected.length > 0) return { outcome: "unauthorized", unauthorized: intersection.rejected };
	return { outcome: "authorized" };
}
