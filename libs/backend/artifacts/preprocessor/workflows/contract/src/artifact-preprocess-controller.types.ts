import type { RuntimeWorkloadBinding, RuntimeWorkloadClaim } from "@opencrane/backend/agents/runtime/workloads/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import type { ArtifactPreprocessOutcome } from "./artifact-preprocess-outcome.types";

/**
 * Carries the server-owned task facts a controller needs to bind one PDF Job.
 *
 * The server selects the preprocessing job and issues the claim. The controller returns fenced Job
 * and Pod identities through this contract; it does not create or persist the claim itself.
 */
export interface ArtifactPreprocessControllerRecord
{
	/** Saved PDF preprocessing job selected by the server. */
	readonly preprocessJobId: string;
	/** Silo that owns the published source PDF and its one-shot Job. */
	readonly siloId: string;
	/** Current delivery that alone may bind the PDF preprocessing workload. */
	readonly claim: RuntimeWorkloadClaim;
}

/** Carries the controller-provided Job identity and opaque bootstrap reference for server persistence. */
export interface ArtifactPreprocessWorkloadBindCommand
{
	/** Exact claim delivery and immutable Kubernetes Job UID to bind. */
	readonly binding: RuntimeWorkloadBinding;
	/** Opaque reference that the server hashes before storing it beside the bound Job. */
	readonly bootstrapReference: string;
	/** Isolated namespace supplied with the Job binding. */
	readonly namespace: string;
}

/** Carries the controller-provided first worker Pod identity for server persistence. */
export interface ArtifactPreprocessPodBindCommand
{
	/** Job binding extended with the immutable first-Pod UID. */
	readonly binding: RuntimeWorkloadBinding;
}

/**
 * Identifies the server-owned completion evidence that wakes a controller task.
 *
 * The event carries this small identity, then the controller reloads the matching inbox entry
 * before it asks the authority to make the PDF job terminal.
 */
export interface ArtifactPreprocessCompletion
{
	/** Names the preprocessing job that owns the saved completion. */
	readonly preprocessJobId: string;
	/** Names the digest that identifies the server-owned completion inbox entry. */
	readonly completionDigest: string;
}

/**
 * Defines the server authority that issues and persists PDF-controller bindings.
 *
 * The controller supplies a fenced Job or Pod identity, but the server owns the saved claim and
 * decides whether that identity may bind it. An implementation must not let controller code write
 * claim or binding state directly.
 */
export interface ArtifactPreprocessControllerAuthority
{
	/**
	 * Issues or reloads the server-owned claim for one admitted task.
	 *
	 * @param preprocessJobId - Saved PDF preprocessing job requested by the controller task.
	 * @param task - Receipt that identifies the admitted controller task.
	 * @returns The server-selected job and claim, or `null` when no claim can be issued.
	 */
	claimForTask(preprocessJobId: string, task: IWorkflowTaskReceipt): Promise<ArtifactPreprocessControllerRecord | null>;
	/**
	 * Records a fenced Kubernetes Job identity for the server-issued claim.
	 *
	 * @param preprocessJobId - Saved PDF preprocessing job that owns the claim.
	 * @param task - Receipt that identifies the admitted controller task.
	 * @param command - Fenced Job identity and bootstrap reference supplied by the controller.
	 * @returns Whether the server bound this identity, had already bound it, or rejected it.
	 */
	bindWorkload(preprocessJobId: string, task: IWorkflowTaskReceipt, command: ArtifactPreprocessWorkloadBindCommand): Promise<"bound" | "idempotent" | "conflict">;
	/**
	 * Records the controller-observed first Pod identity for a fenced Job binding.
	 *
	 * @param preprocessJobId - Saved PDF preprocessing job that owns the claim.
	 * @param task - Receipt that identifies the admitted controller task.
	 * @param command - Fenced first-Pod identity supplied by the controller.
	 * @returns Whether the server bound this identity, had already bound it, or rejected it.
	 */
	bindFirstPod(preprocessJobId: string, task: IWorkflowTaskReceipt, command: ArtifactPreprocessPodBindCommand): Promise<"bound" | "idempotent" | "conflict">;
	/**
	 * Loads the saved worker outcome after the controller receives its wake-up event.
	 *
	 * Called by: `__CreateArtifactPreprocessHandler` and `__CreateArtifactPreprocessControllerRouter`.
	 * A `null` result tells the handler that the requested delivery has no matching outcome, so it
	 * must leave the Kubernetes Job in place and retry the observation.
	 *
	 * @param preprocessJobId - Saved PDF preprocessing job requested by the controller task.
	 * @param deliveryCount - Claimed worker delivery carried by the controller event.
	 * @param task - Receipt that identifies the admitted controller task.
	 * @returns The matching completion, retryable failure, or terminal failure; otherwise `null`.
	 */
	loadOutcome(preprocessJobId: string, deliveryCount: number, task: IWorkflowTaskReceipt): Promise<ArtifactPreprocessOutcome | null>;
	/**
	 * Applies completion evidence the controller loaded from this authority.
	 *
	 * Called by: `__CreateArtifactPreprocessHandler` and `__CreateArtifactPreprocessControllerRouter`.
	 * `completed` makes this call the terminal writer, `idempotent` means it was already applied,
	 * and `conflict` makes the handler stop.
	 *
	 * @param preprocessJobId - Saved PDF preprocessing job requested by the controller task.
	 * @param completion - Completion evidence returned by {@link loadOutcome}.
	 * @param task - Receipt that identifies the admitted controller task.
	 * @returns Whether the completion was applied, had already been applied, or conflicts.
	 */
	complete(preprocessJobId: string, completion: ArtifactPreprocessCompletion, task: IWorkflowTaskReceipt): Promise<"completed" | "idempotent" | "conflict">;
}
