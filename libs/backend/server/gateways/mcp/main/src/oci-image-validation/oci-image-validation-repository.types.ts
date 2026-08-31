import type { OciImageAdmissionResult, OciImageLayoutArtifactTarget, OciImageValidationStates, OciImageVerificationFailureCodes } from "./oci-image-validation.types";

/** Fields required to create or replay one OCI image submission. */
export interface OciImageValidationSubmissionRecord extends OciImageLayoutArtifactTarget
{
	/** Digest of the caller key used to find a retried submission. */
	readonly submissionKeyDigest: string;
	/** Digest that binds every immutable submission field. */
	readonly submissionDigest: string;
	/** Authenticated administrator recorded as the submission creator. */
	readonly createdByPrincipalId: string;
}

/** Product fields returned to an administrator after submission or replay. */
export interface OciImageValidationRecord
{
	/** Stable product validation identifier. */
	readonly id: string;
	/** Silo that owns the validation. */
	readonly siloId: string;
	/** Exact artifact selected for admission. */
	readonly artifactId: string;
	/** Exact published artifact revision selected for admission. */
	readonly artifactRevisionId: string;
	/** Canonical SHA-256 address saved when the request was admitted. */
	readonly contentAddress: string;
	/** Compressed byte count saved when the request was admitted. */
	readonly byteLength: number;
	/** Media type saved with the immutable artifact revision. */
	readonly mediaType: string;
	/** Digest that binds every immutable submission field. */
	readonly submissionDigest: string;
	/** Current product decision. */
	readonly state: OciImageValidationStates;
	/** Digest of the accepted OCI image-layout index bytes. */
	readonly indexDigest: string | null;
	/** Digest of the selected OCI image manifest. */
	readonly imageManifestDigest: string | null;
	/** Digest of the selected OCI image configuration. */
	readonly configDigest: string | null;
	/** Digest-pinned registry image reference that runtime claims may consume. */
	readonly registryReference: string | null;
	/** Bounded fixed reason when the layout admission was rejected. */
	readonly failureCode: OciImageVerificationFailureCodes | null;
}

/** Result of claiming and resolving one caller submission key. */
export interface OciImageValidationCreateResult
{
	/** True only when this transaction created the validation row. */
	readonly created: boolean;
	/** Validation selected by the caller's submission key. */
	readonly validation: OciImageValidationRecord;
}

/** Result after one transaction tries to save an admission answer. */
export interface OciImageValidationWriteResult
{
	/** True when this transaction moved the pending row to a final state. */
	readonly changed: boolean;
	/** Stored winner after the idempotent update. */
	readonly validation: OciImageValidationRecord;
}

/** Transaction-scoped persistence operations owned by OCI image validation. */
export interface OciImageValidationRepository
{
	/**
	 * Creates a pending validation or returns the row already claimed by this request key.
	 *
	 * @param submission - Authenticated silo, immutable artifact facts, and stable request digests.
	 * @returns A new or existing validation; `null` means the key belongs to different input.
	 */
	createOrFind(submission: OciImageValidationSubmissionRecord): Promise<OciImageValidationCreateResult | null>;
	/**
	 * Finds one validation for an authenticated administrator without exposing another silo.
	 *
	 * @param siloId - Silo derived from the authenticated request.
	 * @param validationId - Product validation identifier from the route.
	 * @returns The validation, or `null` when it is absent or belongs to another silo.
	 */
	find(siloId: string, validationId: string): Promise<OciImageValidationRecord | null>;
	/**
	 * Loads one validation only when its silo and submission digest still match the task.
	 *
	 * @param siloId - Keeps the read inside the admitted silo.
	 * @param validationId - Identifies the product row the task was admitted for.
	 * @param submissionDigest - Rejects a task whose immutable submission fields were replaced.
	 * @returns The stored validation, or `null` when the task no longer names it exactly.
	 */
	load(siloId: string, validationId: string, submissionDigest: string): Promise<OciImageValidationRecord | null>;
	/**
	 * Stores one pending validation's final result or returns the result that already won.
	 *
	 * @param siloId - Keeps the update inside the admitted silo.
	 * @param validationId - Identifies the validation to finish.
	 * @param submissionDigest - Prevents stale work from changing replaced input.
	 * @param result - Bounded OCI layout answer returned by the verifier.
	 * @returns The stored winner and whether this call changed it, or `null` when input no longer matches.
	 */
	recordResult(siloId: string, validationId: string, submissionDigest: string, result: OciImageAdmissionResult): Promise<OciImageValidationWriteResult | null>;
}
