import type { RuntimeWorkloadBinding, RuntimeWorkloadClaim } from "@opencrane/backend/agents/runtime/workloads/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

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
}
