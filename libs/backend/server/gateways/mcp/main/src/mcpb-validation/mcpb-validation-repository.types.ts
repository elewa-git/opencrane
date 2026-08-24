import type { McpbBundleArtifactTarget, McpbValidationStates, McpbVerificationFailureCodes, McpbVerificationResult } from "./mcpb-validation.types";

/**
 * Identifies the workflow task admitted for an MCP bundle validation.
 *
 * The repository saves these facts with the validation in the admission transaction. A retry may
 * reuse that workload record only when every task fact still matches.
 * @see McpbValidationRepository.ensureWorkload
 */
export interface McpbValidationWorkloadTask
{
	/** Lets a retry reject a workload record for a different admitted task. */
	readonly taskId: string;
	/** Lets a retry reject a task that names a different registered handler. */
	readonly taskName: string;
	/** Lets a retry reject a task with a different workflow idempotency key. */
	readonly taskKey: string;
}

/** One temporary controller lease for a pending MCP bundle validator Job. */
export interface McpbValidationWorkloadClaim
{
	/** Durable workload identifier used in the later assignment command. */
	readonly workloadId: string;
	/** Silo that owns the validation selected for this controller pass. */
	readonly siloId: string;
	/** Validation used to derive the deterministic validator Job name. */
	readonly validationId: string;
	/** Exact timestamp the repository stored for this controller lease. */
	readonly claimedAt: string;
	/** Delivery generation that fences an older controller replica. */
	readonly deliveryCount: number;
	/** Timestamp after which another controller may take an unassigned workload. */
	readonly expiresAt: string;
}

/** Kubernetes Job identity returned after a controller creates one suspended validator Job. */
export interface McpbValidationWorkloadAssignment
{
	/** Exact controller-lease timestamp returned by {@link McpbValidationWorkloadClaim}. */
	readonly claimedAt: string;
	/** Exact controller delivery generation returned by {@link McpbValidationWorkloadClaim}. */
	readonly deliveryCount: number;
	/** Immutable Kubernetes Job UID returned by the Kubernetes API. */
	readonly workloadUid: string;
}

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
	 * Saves or reuses the workload record for a task admitted with this validation.
	 *
	 * Submission retries admit the workflow task again, so an existing record is reusable only when
	 * its silo and every task fact still match. `null` tells the caller that a different task is
	 * already bound to the validation and the transaction must fail.
	 * @param siloId - Keeps the saved workload inside its owning silo.
	 * @param validationId - Binds the workload to one immutable validation.
	 * @param task - Identifies the admitted workflow task that owns the validation decision.
	 * @returns The workload identifier, or `null` when a different task is already bound.
	 */
	ensureWorkload(siloId: string, validationId: string, task: McpbValidationWorkloadTask): Promise<string | null>;
	/**
	 * Claims one pending workload for a short controller lease.
	 *
	 * @param leaseMilliseconds - Maximum time that one controller may hold the assignment lease.
	 * @returns The saved validation coordinates and claim fence, or `null` when no workload is ready.
	 */
	claimNextWorkload(leaseMilliseconds: number): Promise<McpbValidationWorkloadClaim | null>;
	/**
	 * Records a Kubernetes Job UID only when the controller still holds the workload lease.
	 *
	 * @param workloadId - Identifies the workload the controller claimed.
	 * @param assignment - Lease fence and immutable Job UID returned by Kubernetes.
	 * @returns Whether the assignment was saved, already saved, or lost its controller lease.
	 */
	commitWorkloadAssignment(workloadId: string, assignment: McpbValidationWorkloadAssignment): Promise<"assigned" | "idempotent" | "conflict">;
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
