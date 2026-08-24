import type { McpbBundleArtifactTarget, McpbValidationStates, McpbVerificationFailureCodes, McpbVerificationResult } from "./mcpb-validation.types";

/** Fields required to create or replay one MCP bundle submission. */
export interface McpbValidationSubmissionRecord extends McpbBundleArtifactTarget
{
	/** Digest of the caller key used to find a retried submission. */
	readonly submissionKeyDigest: string;
	/** Digest that binds every immutable submission field. */
	readonly submissionDigest: string;
	/** Authenticated administrator recorded as the submission creator. */
	readonly createdByPrincipalId: string;
}

/** Product fields returned to an administrator after submission or replay. */
export interface McpbValidationRecord
{
	/** Stable product validation identifier. */
	readonly id: string;
	/** Silo that owns the validation. */
	readonly siloId: string;
	/** Exact artifact selected for verification. */
	readonly artifactId: string;
	/** Exact published artifact revision selected for verification. */
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
	readonly state: McpbValidationStates;
	/** Validated manifest name when the bundle passed. */
	readonly manifestName: string | null;
	/** Validated bundle version when the bundle passed. */
	readonly bundleVersion: string | null;
	/** Exact root manifest digest when the bundle passed. */
	readonly manifestDigest: string | null;
	/** Trusted certificate common name when the bundle passed. */
	readonly publisher: string | null;
	/** Trusted certificate fingerprint when the bundle passed. */
	readonly signerFingerprint: string | null;
	/** Bounded fixed reason when the bundle was rejected. */
	readonly failureCode: McpbVerificationFailureCodes | null;
}

/** Result of claiming and resolving one caller submission key. */
export interface McpbValidationCreateResult
{
	/** True only when this transaction created the validation row. */
	readonly created: boolean;
	/** Validation selected by the caller's submission key. */
	readonly validation: McpbValidationRecord;
}

/** Result after one transaction tries to save a verification answer. */
export interface McpbValidationWriteResult
{
	/** True when this transaction moved the pending row to a final state. */
	readonly changed: boolean;
	/** Stored winner after the idempotent update. */
	readonly validation: McpbValidationRecord;
}

/** Transaction-scoped persistence operations owned by MCP bundle validation. */
export interface McpbValidationRepository
{
	/**
	 * Creates a pending validation or returns the row already claimed by this request key.
	 *
	 * @param submission - Authenticated silo, immutable artifact facts, and stable request digests.
	 * @returns A new or existing validation; `null` means the key belongs to different input.
	 */
	createOrFind(submission: McpbValidationSubmissionRecord): Promise<McpbValidationCreateResult | null>;
	/**
	 * Finds one validation for an authenticated administrator without exposing another silo.
	 *
	 * @param siloId - Silo derived from the authenticated request.
	 * @param validationId - Product validation identifier from the route.
	 * @returns The validation, or `null` when it is absent or belongs to another silo.
	 */
	find(siloId: string, validationId: string): Promise<McpbValidationRecord | null>;
	/**
	 * Loads one validation only when its silo and submission digest still match the task.
	 *
	 * @param siloId - Keeps the read inside the admitted silo.
	 * @param validationId - Identifies the product row the task was admitted for.
	 * @param submissionDigest - Rejects a task whose immutable submission fields were replaced.
	 * @returns The stored validation, or `null` when the task no longer names it exactly.
	 */
	load(siloId: string, validationId: string, submissionDigest: string): Promise<McpbValidationRecord | null>;
	/**
	 * Stores one pending validation's final result or returns the result that already won.
	 *
	 * @param siloId - Keeps the update inside the admitted silo.
	 * @param validationId - Identifies the validation to finish.
	 * @param submissionDigest - Prevents stale work from changing replaced input.
	 * @param result - Bounded manifest/signature answer returned by the verifier.
	 * @returns The stored winner and whether this call changed it, or `null` when input no longer matches.
	 */
	recordResult(siloId: string, validationId: string, submissionDigest: string, result: McpbVerificationResult): Promise<McpbValidationWriteResult | null>;
}
