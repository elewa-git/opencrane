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
 * Reads the skill list for one silo.
 *
 * Read-only by design, and it returns names and lifecycle states only — never skill bundles,
 * artifact addresses, manifests, review evidence, signatures, or workload details. The `siloId` is
 * already trusted when it arrives: the router derives it from the authenticated session, never from
 * the request.
 *
 * Implemented by: `PrismaSkillCatalogueRepository` in `prisma-skill-catalogue-repository.ts`.
 * Called by: {@link __CreateSkillCatalogueRouter} in `skill-catalogue.router.ts`; wired in
 * `prisma-skill-catalogue.router.ts`.
 */
export interface SkillCatalogueRepository
{
/**
 * Lists the skills in one silo, most recently updated first, tie-broken by id so the order is
 * repeatable. At most 200 rows; there is no paging, so a silo with more is silently truncated.
 *
 * @param siloId - Silo already derived from the authenticated session.
 * @returns Catalogue summaries. An empty array means the silo has no skills — a silo that does not
 *   exist is indistinguishable from an empty one.
 * @throws Whatever the database layer throws; the router logs it and answers 503.
 */
	listCatalogue(siloId: string): Promise<readonly SkillCatalogueEntry[]>;
}
