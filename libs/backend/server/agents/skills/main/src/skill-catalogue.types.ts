/** Browser-safe lifecycle states returned by the governed skill catalogue. */
export enum SkillCatalogueStates
{
	/** The logical skill can provide its current published revision to future admissions. */
	Active = "active",
	/** The logical skill remains visible as history but can provide no future revision. */
	Retired = "retired",
}

/** Browser-safe lifecycle states returned for a selected current skill revision. */
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

/** Reads the browser-safe skill catalogue within an already trusted silo boundary. */
export interface SkillCatalogueRepository
{
	/** Returns a bounded, deterministic list of skill summaries from one silo. */
	listCatalogue(siloId: string): Promise<readonly SkillCatalogueEntry[]>;
}
