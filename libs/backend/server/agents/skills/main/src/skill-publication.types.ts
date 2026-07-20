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
	/** Test, scan, and signature evidence. */
	readonly evidence: SkillPublicationEvidence;
}

/** Consistent publication authority snapshot. */
export interface SkillPublicationSnapshot
{
	/** Current SkillRevision lifecycle state. */
	readonly state: "draft" | "review" | "published" | "rejected" | "revoked";
	/** Whether the referenced artifact is still published. */
	readonly artifactPublished: boolean;
	/** Exact content address held by Artifact metadata. */
	readonly artifactContentAddress: string;
}

/** Atomic skill publication result. */
export type AtomicPublishSkillRevisionResult = { readonly status: "published" } | { readonly status: "conflict" } | { readonly status: "not_found" };

/** Persistence boundary binding publication to exact ArtifactRevision authority. */
export interface SkillAuthorityRepository
{
	/** Loads revision and artifact authority from one consistent snapshot. */
	getPublicationSnapshot(command: PublishSkillRevisionCommand): Promise<SkillPublicationSnapshot | null>;
	/** Publishes and advances the current pointer only while snapshot facts still match. */
	publishAtomically(command: PublishSkillRevisionCommand): Promise<AtomicPublishSkillRevisionResult>;
}

/** Stable result of skill publication. */
export type PublishSkillRevisionResult =
	| { readonly outcome: "published" }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "not_found" | "not_in_review" | "artifact_unpublished" | "artifact_mismatch" | "conflict" };
