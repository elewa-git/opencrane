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

/** Stable result of skill publication. */
export type PublishSkillRevisionResult =
	| { readonly outcome: "published" }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "not_found" | "skill_retired" | "not_in_review" | "artifact_unpublished" | "artifact_mismatch" | "review_evidence_missing" | "conflict" };
