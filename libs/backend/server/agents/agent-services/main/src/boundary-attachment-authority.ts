import type { RevisionBoundaryAttachment } from "@opencrane/models/agents";

import type { BoundaryAttachAuthorityResult, BoundaryAttachmentIntersection, BoundaryGrantResolver, EffectiveBoundaryGrant } from "./boundary-attachment-authority.types";

/** NUL-delimited canonical key for one boundary attachment, safe against concatenation aliasing. */
function _boundaryKey(boundary: { boundaryKind: string; boundaryId: string; boundaryCoverage: string }): string
{
	return `${boundary.boundaryKind}\u0000${boundary.boundaryId}\u0000${boundary.boundaryCoverage}`;
}

/**
 * Splits requested attachments into those backed by a real grant and those not.
 *
 * No database, no clock: an attachment survives only when the same boundary kind, identifier, and
 * coverage appears in the grant list. Since that list holds allow entries only, the
 * result can never contain access the principals do not already hold — an attachment narrows what
 * they can reach, it never widens it.
 *
 * Called by: {@link __ResolveEffectiveBoundaryAttachments} in this file, which is the only production
 * entry point; tests call this directly with fixed grant lists.
 *
 * @param attachments - The attachments a revision declares.
 * @param effectiveGrants - Allow-only grants the principals hold.
 * @returns `authorized` (backed) and `rejected` (unbacked), preserving input order in both.
 */
export function __IntersectBoundaryAttachments(attachments: readonly RevisionBoundaryAttachment[], effectiveGrants: readonly EffectiveBoundaryGrant[]): BoundaryAttachmentIntersection
{
	const allowed = new Set(effectiveGrants.map(_boundaryKey));
	const authorized: RevisionBoundaryAttachment[] = [];
	const rejected: RevisionBoundaryAttachment[] = [];
	for (const attachment of attachments)
	{
		if (allowed.has(_boundaryKey(attachment)))
			authorized.push(attachment);
		else rejected.push(attachment);
	}
	return { authorized, rejected };
}

/**
 * Resolve the runtime's effective knowledge-boundary access for a set of attachments.
 *
 * Compiles the agent's effective grants for its execution principals and intersects the attachments
 * against them, so the runtime is handed only the boundaries the agent actually has effective access
 * to. Exact and Descendants coverage remain different grants and never match implicitly.
 *
 * Called by: {@link __ValidateBoundaryAttachAuthority} in this file, and
 * `PrismaManagedExecutionEvidenceAuthority.load` in `db/prisma-managed-execution-evidence.ts`, which
 * denies the run outright if anything is rejected.
 *
 * @param resolver - Grant lookup. Not called at all when `attachments` is empty.
 * @param principalIds - The principals the agent runs as.
 * @param attachments - The attachments the revision declares.
 * @returns `authorized` (given to the runtime) and `rejected` (dropped).
 */
export async function __ResolveEffectiveBoundaryAttachments(resolver: BoundaryGrantResolver, siloId: string, principalIds: readonly string[], attachments: readonly RevisionBoundaryAttachment[], nowEpochMs: number): Promise<BoundaryAttachmentIntersection>
{
	if (attachments.length === 0)
		return { authorized: [], rejected: [] };
	const effectiveGrants = await resolver.resolveEffectiveBoundaryGrants({ siloId, principalIds, attachments, nowEpochMs });
	return __IntersectBoundaryAttachments(attachments, effectiveGrants);
}

/**
 * Validate at authoring time that a caller administers every boundary they attach.
 *
 * Compiles the caller's own effective grants and requires each declared attachment to be backed by
 * one, so an administrator cannot attach a boundary they do not themselves hold. Any unbacked
 * attachment fails closed with the exact offending triples, which the router maps to a 403.
 *
 * @param resolver - Effective-grant resolver.
 * @param callerPrincipalIds - The attaching caller's principals.
 * @param attachments - Declared revision boundary attachments.
 * @returns Authorised, or unauthorised with the offending attachments.
 */
export async function __ValidateBoundaryAttachAuthority(resolver: BoundaryGrantResolver, siloId: string, callerPrincipalIds: readonly string[], attachments: readonly RevisionBoundaryAttachment[], nowEpochMs: number): Promise<BoundaryAttachAuthorityResult>
{
	if (attachments.length === 0)
		return { outcome: "authorized" };
	const intersection = await __ResolveEffectiveBoundaryAttachments(resolver, siloId, callerPrincipalIds, attachments, nowEpochMs);
	if (intersection.rejected.length > 0)
		return { outcome: "unauthorized", unauthorized: intersection.rejected };
	return { outcome: "authorized" };
}
