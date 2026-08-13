import type { GrantScope, GrantSubjectType, RevisionScopeAttachment } from "@opencrane/models/agents";

/**
 * One knowledge scope a set of principals really holds.
 *
 * It uses the same three fields as a declared attachment — `scope`, `subjectType`, `subjectId` — on
 * purpose: matching is a plain exact match on all three, with no widening or inheritance. An
 * attachment is authorised when, and only when, the identical triple appears in this list.
 */
export interface EffectiveScopeGrant
{
	/** Scope level of the grant: `org`, `department`, `team`, `project`, or `personal`. */
	readonly scope: GrantScope;
	/** Whether `subjectId` names a `group` or a `user`. */
	readonly subjectType: GrantSubjectType;
	/** Identifier of the scoped knowledge target the effective grant covers. */
	readonly subjectId: string;
}

/**
 * Lists the knowledge scopes a set of principals actually holds.
 *
 * The list is ALLOW-only: a scope that was denied, or was never granted, simply is not in it. There
 * is no deny entry to misread, so filtering a set of requested attachments against this list can only
 * ever remove entries — it can never hand out access a principal does not already have. Every caller
 * in this file depends on that property.
 *
 * WARNING: the production implementation `PrismaScopeGrantResolver` currently returns an empty list
 * (its grant compiler was removed and RbacAuthority is not wired up yet). With an empty list every
 * declared attachment is rejected, so authoring a revision with any scope attachment is refused with
 * 403 and a managed run with any attachment is denied `memory_scope_unavailable`. Tests pass a fake
 * resolver, which is why the intersection logic is still exercised.
 *
 * Implemented by: `PrismaScopeGrantResolver` in `prisma-scope-grant-resolver.ts`.
 * Called by: {@link __ResolveEffectiveScopeAttachments} and {@link __ValidateAttachAuthority} in
 * `scope-attachment-authority.ts`; injected as `scopeGrantResolver` by
 * `prisma-agent-services.router.ts` and constructed inline by `prisma-managed-execution-evidence.ts`.
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

/**
 * Outcome of the authoring-time check that a caller holds every scope they are attaching.
 *
 * `unauthorized` lists the exact attachments with no backing grant, so the router can tell the
 * administrator which ones to remove or get granted. It is all-or-nothing: nothing is persisted, not
 * even the attachments that did pass.
 */
export type AttachAuthorityResult =
	| { readonly outcome: "authorized" }
	| { readonly outcome: "unauthorized"; readonly unauthorized: readonly RevisionScopeAttachment[] };
