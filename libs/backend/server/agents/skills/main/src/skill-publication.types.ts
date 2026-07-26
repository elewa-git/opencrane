/** Complete review evidence required before skill publication. */
export interface SkillPublicationEvidence
{
	/** Structured test result produced by the isolated authoring Job. */
	readonly testReport: Readonly<Record<string, unknown>>;
	/** Structured security, secret, license, and malware scan result. */
	readonly scanResult: Readonly<Record<string, unknown>>;
	/** Signature over the exact revision and artifact digest. */
	readonly signature: string;
	/** Trusted signer key identifier. */
	readonly signerKeyId: string;
}

/** Request to publish one exact reviewed SkillRevision. */
export interface PublishSkillRevisionCommand
{
	/** Trusted ClusterTenant scope derived by the application from the request host. */
	readonly siloId: string;
	/** Stable logical skill. */
	readonly skillId: string;
	/** Immutable skill revision being published. */
	readonly skillRevisionId: string;
	/** Exact ArtifactRevision containing the bundle. */
	readonly artifactRevisionId: string;
	/** Exact content address pinned by the ArtifactRevision. */
	readonly artifactContentAddress: string;
	/** User approving the reviewed revision. */
	readonly reviewedBy: string;
	/** Trusted publication instant. */
	readonly publishedAt: string;
}

/** Consistent publication authority snapshot. */
export interface SkillPublicationSnapshot
{
	/** Logical skill lifecycle state at the instant the publication preflight reads it. */
	readonly skillState: "active" | "retired";
	/** Current published revision observed before the compare-and-swap publication attempt. */
	readonly currentRevisionId: string | null;
	/** Current SkillRevision lifecycle state. */
	readonly state: "draft" | "review" | "published" | "rejected" | "revoked";
	/** Whether the referenced artifact is still published. */
	readonly artifactPublished: boolean;
	/** Exact content address held by Artifact metadata. */
	readonly artifactContentAddress: string;
	/** Server-owned evidence recorded by the isolated review job before the revision entered review. */
	readonly evidence: SkillPublicationEvidence | null;
}

/** Atomic skill publication result. */
export type AtomicPublishSkillRevisionResult = { readonly status: "published" } | { readonly status: "conflict" } | { readonly status: "not_found" };

/** Persistence boundary binding publication to exact ArtifactRevision authority. */
export interface SkillAuthorityRepository
{
	/** Loads revision and artifact authority from one consistent snapshot. */
	getPublicationSnapshot(command: PublishSkillRevisionCommand): Promise<SkillPublicationSnapshot | null>;
	/** Publishes and advances the pointer only when its observed current revision remains unchanged. */
	publishAtomically(command: PublishSkillRevisionCommand, expectedCurrentRevisionId: string | null): Promise<AtomicPublishSkillRevisionResult>;
}

/** Request to revoke one exact published SkillRevision for future admissions. */
export interface RevokeSkillRevisionCommand
{
	/** Trusted ClusterTenant scope derived by the application from the request host. */
	readonly siloId: string;
	/** Stable logical skill containing the revision. */
	readonly skillId: string;
	/** Immutable published revision being withdrawn from future use. */
	readonly skillRevisionId: string;
	/** Trusted server-side instant at which the revision became unavailable. */
	readonly revokedAt: string;
}

/** Atomic persistence outcome from revoking a published SkillRevision. */
export type AtomicRevokeSkillRevisionResult = { readonly status: "revoked" } | { readonly status: "conflict" } | { readonly status: "not_found" } | { readonly status: "not_published" };

/** Persistence boundary for the future-only skill-revision revocation transition. */
export interface SkillRevocationRepository
{
	/** Revokes one exact published revision and clears its current pointer when applicable. */
	revokeAtomically(command: RevokeSkillRevisionCommand): Promise<AtomicRevokeSkillRevisionResult>;
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
	readonly state: "active" | "retired";
	/** Identifier of the revision selected for new admissions, when any. */
	readonly currentRevisionId: string | null;
	/** Lifecycle state of the selected revision, when any. */
	readonly currentRevisionState: "draft" | "review" | "published" | "rejected" | "revoked" | null;
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

/** Stable result of attempting to revoke one skill revision. */
export type RevokeSkillRevisionResult = { readonly outcome: "revoked" } | { readonly outcome: "denied"; readonly reason: "invalid_command" | "not_found" | "not_published" | "conflict" };

/** Stable result of skill publication. */
export type PublishSkillRevisionResult =
	| { readonly outcome: "published" }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "not_found" | "skill_retired" | "not_in_review" | "artifact_unpublished" | "artifact_mismatch" | "review_evidence_missing" | "conflict" };
