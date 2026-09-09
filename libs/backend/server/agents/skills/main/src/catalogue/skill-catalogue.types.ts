/**
 * Whether a skill can still supply a revision to new agent runs.
 *
 * `Active` means it can, if its current revision is published. `Retired` means it never will again:
 * the skill stays listed so past runs and assignments still make sense, but nothing new may use it.
 * A retired skill is not deleted and does not disappear from the catalogue.
 *
 * Both conditions must hold for a new run — an `Active` skill whose current revision is not
 * {@link SkillCatalogueRevisionStates.Published} is equally unusable. The strings are stable; they
 * appear in the `/skills` response and its OpenAPI schema.
 */
export enum SkillCatalogueStates
{
	/** The logical skill can provide its current published revision to future admissions. */
	Active = "active",
	/** The logical skill remains visible as history but can provide no future revision. */
	Retired = "retired",
}

/**
 * Where a skill revision is in its review lifecycle.
 *
 * Only {@link SkillCatalogueRevisionStates.Published} may be used by a new agent run. Every other
 * value means the revision cannot be assigned: `Draft` and `Review` are not through review yet,
 * `Rejected` failed it, and `Revoked` was withdrawn after having been published — so a run admitted
 * earlier may still be using it, but no new one can start on it.
 *
 * A skill's entry can carry a non-`Published` revision state: the skill still shows in the catalogue,
 * but nothing new can be pointed at that revision. Reading the state as "available" because the
 * entry exists is the mistake this enum is here to prevent.
 *
 * The strings are stable — they appear in the `/skills` response and its OpenAPI schema.
 */
export enum SkillCatalogueRevisionStates
{
	/** The immutable revision is still being authored. */
	Draft = "draft",
	/** The immutable revision awaits publication after isolated evidence review. */
	Review = "review",
	/** The immutable revision is eligible for future governed admissions. */
	Published = "published",
	/** The immutable revision was rejected by the review authority. */
	Rejected = "rejected",
	/** The immutable revision was withdrawn from future admissions. */
	Revoked = "revoked",
}

/** A browser-safe summary of one governed skill in the caller's silo. */
export interface SkillCatalogueEntry
{
	/** Stable skill identifier. */
	readonly id: string;
	/** Human-readable skill name. */
	readonly name: string;
	/** Human-readable summary supplied while authoring the skill. */
	readonly description: string;
	/** Current lifecycle state of the logical skill. */
	readonly state: SkillCatalogueStates;
	/** Identifier of the revision selected for new admissions, when any. */
	readonly currentRevisionId: string | null;
	/** Lifecycle state of the selected revision, when any. */
	readonly currentRevisionState: SkillCatalogueRevisionStates | null;
	/** Creation instant in ISO-8601 form. */
	readonly createdAt: string;
	/** Most recent metadata or current-pointer update instant in ISO-8601 form. */
	readonly updatedAt: string;
}

/**
 * Reads the skill list allowed for one Principal in one silo.
 *
 * Read-only by design, and it returns names and lifecycle states only — never skill bundles,
 * artifact addresses, manifests, review evidence, signatures, or workload details. The trusted
 * caller coordinates come from the authenticated session and request host, never request data.
 *
 * Implemented by: `PrismaSkillCatalogueUnitOfWork` in `prisma-skill-catalogue-unit-of-work.ts`.
 * Called by: {@link __CreateSkillCatalogueRouter} in `skill-catalogue.router.ts`; wired in
 * `prisma-skill-catalogue.router.ts`.
 */
export interface SkillCatalogueRepository
{
/**
 * Lists discoverable skills, most recently updated first and tie-broken by id. The domain loads at
 * most 200 lifecycle candidates and filters them through one central authorization batch.
 *
 * @param siloId - Silo already derived from the authenticated session.
 * @param principalId - Local Principal derived from the verified session.
 * @returns Allowed catalogue summaries. An empty array does not disclose whether other skills exist.
 * @throws Whatever the database layer throws; the router logs it and answers 503.
 */
	listCatalogue(siloId: string, principalId: string): Promise<readonly SkillCatalogueEntry[]>;
}
