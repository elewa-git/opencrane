/** Product-level kinds of canonical artifacts. */
export type ArtifactKind = "document" | "generated" | "skill" | "upload";

/** Stable identifier of a logical artifact. */
export type ArtifactId = string;

/** Stable identifier of an immutable artifact revision. */
export type ArtifactRevisionId = string;

/** Stable identifier of an immutable skill revision. */
export type SkillRevisionId = string;

/** Stable logical artifact independent from any storage backend. */
export interface Artifact
{
	/** Stable artifact identifier. */
	readonly id: ArtifactId;
	/** Principal that owns the artifact. */
	readonly ownerPrincipalId: string;
	/** Product-level artifact kind. */
	readonly kind: ArtifactKind;
	/** Current immutable content-addressed revision, or null before the first revision. */
	readonly currentRevision: ArtifactRevisionReference | null;
	/** Canonical ISO-8601 creation timestamp. */
	readonly createdAt: string;
}

/** Content-addressed reference to immutable artifact bytes. */
export interface ArtifactContentReference
{
	/** Lowercase SHA-256 content address in `sha256:<hex>` form. */
	readonly contentAddress: string;
	/** Exact byte length of the addressed content. */
	readonly byteLength: number;
	/** Media type used to interpret the addressed bytes. */
	readonly mediaType: string;
}

/** Immutable revision of a logical artifact. */
export interface ArtifactRevision
{
	/** Stable revision identifier. */
	readonly id: ArtifactRevisionId;
	/** Logical artifact that owns this revision. */
	readonly artifactId: ArtifactId;
	/** Content-addressed immutable bytes for this revision. */
	readonly content: ArtifactContentReference;
	/** Earlier revisions from which this revision was derived. */
	readonly parentRevisionIds: readonly ArtifactRevisionId[];
	/** Canonical ISO-8601 creation timestamp. */
	readonly createdAt: string;
}

/** Storage-neutral reference from another model to an artifact revision. */
export interface ArtifactRevisionReference
{
	/** Logical artifact identifier. */
	readonly artifactId: ArtifactId;
	/** Immutable artifact revision identifier. */
	readonly revisionId: ArtifactRevisionId;
	/** Lowercase SHA-256 address pinned so this reference always resolves to the same bytes. */
	readonly contentAddress: string;
}

/** Immutable skill publication backed by a content-addressed artifact revision. */
export interface SkillRevision
{
	/** Stable skill revision identifier. */
	readonly id: SkillRevisionId;
	/** Stable logical skill identifier. */
	readonly skillId: string;
	/** Exact artifact revision containing the published skill bundle. */
	readonly bundle: ArtifactRevisionReference;
	/** Canonical ISO-8601 publication timestamp. */
	readonly createdAt: string;
}
