import type { GrantScope, GrantSubjectType, RevisionScopeAttachment } from "@opencrane/models/agents";

/**
 * One effective knowledge-scope grant a principal set actually holds, compiled from the canonical
 * grant table. The triple is the same `{ scope, subjectType, subjectId }` vocabulary an attachment
 * declares, so an attachment is authorised exactly when it appears here with allow access.
 */
export interface EffectiveScopeGrant
{
	/** Canonical containment scope the effective grant covers. */
	readonly scope: GrantScope;
	/** Canonical principal type the effective grant covers. */
	readonly subjectType: GrantSubjectType;
	/** Identifier of the scoped knowledge target the effective grant covers. */
	readonly subjectId: string;
}

/**
 * Boundary that compiles the effective knowledge-scope grants for a principal set.
 *
 * The production adapter is backed by the IAM grant compiler; a test supplies a fake so the pure
 * intersection can be exercised without a database. It returns only ALLOW grants (deny/absent scopes
 * simply do not appear), so intersecting against it can never widen access.
 */
export interface ScopeGrantResolver
{
	/** Resolves the allow-only effective knowledge-scope grants held by the principal set. */
	resolveEffectiveScopeGrants(principalIds: readonly string[]): Promise<readonly EffectiveScopeGrant[]>;
}

/** Result of intersecting declared attachments against a set of effective grants. */
export interface ScopeAttachmentIntersection
{
	/** Attachments backed by an effective allow grant — the runtime's actual scoped access. */
	readonly authorized: readonly RevisionScopeAttachment[];
	/** Attachments with no backing effective grant — dropped so they grant nothing extra. */
	readonly rejected: readonly RevisionScopeAttachment[];
}

/** Result of validating that a caller may attach every declared scope at authoring time. */
export type AttachAuthorityResult =
	| { readonly outcome: "authorized" }
	| { readonly outcome: "unauthorized"; readonly unauthorized: readonly RevisionScopeAttachment[] };
