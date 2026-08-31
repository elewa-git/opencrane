import type { OciImageValidationRecord } from "./oci-image-validation-repository.types";
import type { OciImageLayoutArtifactTarget } from "./oci-image-validation.types";

/** Resolves caller-supplied artifact coordinates through the artifact catalogue authority. */
export interface OciImageLayoutArtifactResolver
{
	/**
	 * Finds one active published revision inside the authenticated silo.
	 *
	 * @param siloId - Silo derived from the authenticated request.
	 * @param artifactId - Artifact identifier supplied by the administrator.
	 * @param artifactRevisionId - Exact immutable revision to admit.
	 * @returns Trusted artifact facts, or `null` when the coordinates are not readable.
	 */
	resolve(siloId: string, artifactId: string, artifactRevisionId: string): Promise<OciImageLayoutArtifactTarget | null>;
}

/** Carries the administrator's request to admit one published artifact revision as an OCI image. */
export interface OciImageValidationSubmissionCommand
{
	/** Client-generated key that makes a repeated request return the first validation. */
	readonly idempotencyKey: string;
	/** Artifact catalogue identifier inside the authenticated silo. */
	readonly artifactId: string;
	/** Exact immutable artifact revision to admit. */
	readonly artifactRevisionId: string;
}

/**
 * Tells the operator route whether submission may return a validation, a conflict, or not found.
 *
 * These values cross the domain-to-HTTP boundary but are not persisted. `Submitted` includes the
 * existing row on an identical retry, `Conflict` protects a reused key from changed input, and
 * `ArtifactNotFound` also hides artifacts outside the authenticated silo.
 */
export enum OciImageValidationSubmissionOutcomes
{
	/** The request created or returned the same validation and task. */
	Submitted = "submitted",
	/** The idempotency key already belongs to different immutable input. */
	Conflict = "conflict",
	/** The artifact revision was not active, published, or owned by the authenticated silo. */
	ArtifactNotFound = "artifact_not_found",
}

/** Final answer from one OCI image submission attempt. */
export type OciImageValidationSubmissionResult =
	| { readonly outcome: OciImageValidationSubmissionOutcomes.Submitted; readonly validation: OciImageValidationRecord }
	| { readonly outcome: OciImageValidationSubmissionOutcomes.Conflict | OciImageValidationSubmissionOutcomes.ArtifactNotFound };
