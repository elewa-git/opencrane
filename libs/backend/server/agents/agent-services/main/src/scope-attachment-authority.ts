import type { RevisionScopeAttachment } from "@opencrane/models/agents";

import type { AttachAuthorityResult, EffectiveScopeGrant, ScopeAttachmentIntersection, ScopeGrantResolver } from "./scope-attachment-authority.types";

/** NUL-delimited canonical key for one scope triple, safe against concatenation aliasing. */
function _tripleKey(triple: { scope: string; subjectType: string; subjectId: string }): string
{
	return `${triple.scope}\u0000${triple.subjectType}\u0000${triple.subjectId}`;
}

/**
 * Splits requested attachments into those backed by a real grant and those not.
 *
 * No database, no clock: an attachment survives only when its exact `{ scope, subjectType,
 * subjectId }` triple appears in the grant list. Since that list holds allow entries only, the
 * result can never contain access the principals do not already hold — an attachment narrows what
 * they can reach, it never widens it.
 *
 * Called by: {@link __ResolveEffectiveScopeAttachments} in this file, which is the only production
 * entry point; tests call this directly with fixed grant lists.
 *
 * @param attachments - The attachments a revision declares.
 * @param effectiveGrants - Allow-only grants the principals hold.
 * @returns `authorized` (backed) and `rejected` (unbacked), preserving input order in both.
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
 * Called by: {@link __ValidateAttachAuthority} in this file, and
 * `PrismaManagedExecutionEvidenceAuthority.load` in `prisma-managed-execution-evidence.ts`, which
 * denies the run outright if anything is rejected.
 *
 * @param resolver - Grant lookup. Not called at all when `attachments` is empty.
 * @param principalIds - The principals the agent runs as.
 * @param attachments - The attachments the revision declares.
 * @returns `authorized` (given to the runtime) and `rejected` (dropped).
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
