import type { RuntimeWorkloadBinding, RuntimeWorkloadClaim } from "@opencrane/backend/agents/runtime/workloads/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

/** Carries the claim and opaque Job identity that the server projects to the controller. */
export interface SkillAuthoringValidationControllerRecord
{
	/** Validation selected by the saved task receipt. */
	readonly validationId: string;
	/** Silo that owns the validation and isolated Job. */
	readonly siloId: string;
	/** Stable opaque value used in the Kubernetes Job name. */
	readonly jobId: string;
	/** Current delivery that alone may bind this validation workload. */
	readonly claim: RuntimeWorkloadClaim;
}

/** Carries the fenced Job identity and one-use bootstrap reference for the server authority. */
export interface SkillAuthoringValidationWorkloadBindCommand
{
	/** Exact claim delivery and Job identity to bind. */
	readonly binding: RuntimeWorkloadBinding;
	/** Opaque reference that the server hashes before it persists it. */
	readonly bootstrapReference: string;
	/** Namespace asserted by the controller and checked against the fixed server profile. */
	readonly namespace: string;
}

/** Carries the fenced first worker Pod identity for the server authority. */
export interface SkillAuthoringValidationPodBindCommand
{
	/** Exact Job binding plus the first Pod identity to bind. */
	readonly binding: RuntimeWorkloadBinding;
}

/** Identifies completion evidence saved before the task receives its wake-up event. */
export interface SkillAuthoringValidationCompletion
{
	/** Validation that owns the completion evidence. */
	readonly validationId: string;
	/** Digest that identifies the saved completion evidence. */
	readonly completionDigest: string;
}

/** Defines controller requests that only the server may authorise and persist. */
export interface SkillAuthoringValidationControllerAuthority
{
	/** Issues or reloads the current claim for this exact task receipt. */
	claimForTask(validationId: string, task: IWorkflowTaskReceipt): Promise<SkillAuthoringValidationControllerRecord | null>;
	/** Binds a Job and bootstrap to the returned claim delivery. */
	bindWorkload(validationId: string, task: IWorkflowTaskReceipt, command: SkillAuthoringValidationWorkloadBindCommand): Promise<"bound" | "idempotent" | "conflict">;
	/** Binds the first Job-owned Pod to the returned claim delivery. */
	bindFirstPod(validationId: string, task: IWorkflowTaskReceipt, command: SkillAuthoringValidationPodBindCommand): Promise<"bound" | "idempotent" | "conflict">;
	/** Loads the completion evidence that the server persisted for this task. */
	loadCompletion(validationId: string, completionDigest: string, task: IWorkflowTaskReceipt): Promise<SkillAuthoringValidationCompletion | null>;
	/** Applies the saved completion as the validation's terminal state. */
	complete(validationId: string, completion: SkillAuthoringValidationCompletion, task: IWorkflowTaskReceipt): Promise<"completed" | "idempotent" | "conflict">;
}
