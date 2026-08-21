import type { RevisionBoundaryAttachment } from "@opencrane/models/agents";

/**
 * One knowledge boundary a set of principals really holds.
 *
 * It uses the same boundary kind, identifier, and coverage as a declared attachment. Matching is
 * exact across all three fields; authorisation never invents hierarchy traversal or broader coverage.
 */
export interface EffectiveBoundaryGrant
{
	/** Stored kind of knowledge boundary covered by the grant. */
	readonly boundaryKind: RevisionBoundaryAttachment["boundaryKind"];
	/** Stable group or principal identifier covered by the grant. */
	readonly boundaryId: string;
	/** Whether the grant covers the named boundary alone or a group subtree. */
	readonly boundaryCoverage: RevisionBoundaryAttachment["boundaryCoverage"];
}

/**
 * Lists the knowledge boundaries a set of principals actually holds.
 *
 * The list is ALLOW-only: a boundary that was denied, or was never granted, simply is not in it. There
 * is no deny entry to misread, so filtering a set of requested attachments against this list can only
 * ever remove entries — it can never hand out access a principal does not already have. Every caller
 * in this file depends on that property.
 *
 * Implemented by: `PrismaBoundaryGrantRepository` in `prisma-boundary-grant-resolver.ts`.
 * Called by: {@link __ResolveEffectiveBoundaryAttachments} and {@link __ValidateBoundaryAttachAuthority} in
 * `boundary-attachment-authority.ts`; injected as `boundaryGrantResolver` by
 * `prisma-agent-services.router.ts` and constructed inline by `prisma-managed-execution-evidence.ts`.
 */
export interface BoundaryGrantResolver
{
	/** Resolves the allow-only effective knowledge-boundary grants held by the principal set. */
	resolveEffectiveBoundaryGrants(command: BoundaryGrantResolutionCommand): Promise<readonly EffectiveBoundaryGrant[]>;
}

/** Trusted coordinates required to resolve generic authorization grants into boundary access. */
export interface BoundaryGrantResolutionCommand
{
	/** Exact silo that owns the principals, hierarchy, and grants. */
	readonly siloId: string;
	/** Durable local Principal ids whose grants are resolved. */
	readonly principalIds: readonly string[];
	/** Revision boundaries whose effective access must be decided. */
	readonly attachments: readonly RevisionBoundaryAttachment[];
	/** Server-owned decision time. */
	readonly nowEpochMs: number;
}

/** Result of intersecting declared boundary attachments against effective grants. */
export interface BoundaryAttachmentIntersection
{
	/** Attachments backed by an effective allow grant — the runtime's actual scoped access. */
	readonly authorized: readonly RevisionBoundaryAttachment[];
	/** Attachments with no backing effective grant — dropped so they grant nothing extra. */
	readonly rejected: readonly RevisionBoundaryAttachment[];
}

/**
 * Outcome of the authoring-time check that a caller holds every boundary they are attaching.
 *
 * `unauthorized` lists the exact attachments with no backing grant, so the router can tell the
 * administrator which ones to remove or get granted. It is all-or-nothing: nothing is persisted, not
 * even the attachments that did pass.
 */
export type BoundaryAttachAuthorityResult =
	| { readonly outcome: "authorized" }
	| { readonly outcome: "unauthorized"; readonly unauthorized: readonly RevisionBoundaryAttachment[] };
