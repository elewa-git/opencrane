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

/** Identifies completion evidence saved for the task's recovery heartbeat. */
export interface SkillAuthoringValidationCompletion
{
	/** Validation that owns the completion evidence. */
	readonly validationId: string;
	/** Digest that identifies the saved completion evidence. */
	readonly completionDigest: string;
}

/** Describes the current durable lifecycle without issuing or renewing a workload claim. */
export type SkillAuthoringValidationCurrentStatus = "active" | "completed" | "cancelled" | "conflict";

/** Reports whether the server saved, already knew, rejected, or expired a workload binding. */
export type SkillAuthoringValidationBindOutcome = "bound" | "idempotent" | "expired" | "conflict";

/** Reports whether recovery ended the validation or must wait for database time. */
export type SkillAuthoringValidationRecoveryOutcome = "failed" | "idempotent" | "not_expired" | "conflict";

/** Carries the remaining lifetime calculated from database time for an authorised release. */
export interface SkillAuthoringValidationReleaseAuthorization
{
	/** Confirms that the exact bound Job may be released. */
	readonly outcome: "authorized";
	/** Whole seconds remaining; HTTP removes its round trip and Kubernetes removes its read and patch budgets before release. */
	readonly releaseLifetimeSeconds: number;
}

/** Reports whether database time still permits the exact bound Job to be released. */
export type SkillAuthoringValidationReleaseOutcome = SkillAuthoringValidationReleaseAuthorization | "expired" | "conflict";

/**
 * Stable task-owned reasons for a Job that ended without a worker completion.
 *
 * Each member is persisted as `SkillAuthoringValidation.failureCode` and ends the validation.
 * Renaming a member therefore requires a forward database migration plus matching controller rules.
 */
export enum SkillAuthoringValidationRecoveryReasons
{
	/** The final database claim expired before a Kubernetes Job could be bound. */
	ClaimExpiredBeforeWorkload = "claim_expired_before_workload",
	/** The released Job never produced a worker before its database claim expired. */
	ClaimExpiredWithoutWorker = "claim_expired_without_worker",
	/** Kubernetes no longer has the exact bound Job and no completion was saved. */
	JobMissingWithoutCompletion = "job_missing_without_completion",
	/** Kubernetes finished the exact bound Job and no completion was saved. */
	JobTerminalWithoutCompletion = "job_terminal_without_completion",
}

/** Defines controller requests that only the server may authorise and persist. */
export interface SkillAuthoringValidationControllerAuthority
{
	/** Issues or reloads the current claim for this exact task receipt. */
	claimForTask(validationId: string, task: IWorkflowTaskReceipt): Promise<SkillAuthoringValidationControllerRecord | null>;
	/** Reads the current lifecycle without changing a claim or product state. */
	loadCurrentStatus(validationId: string, task: IWorkflowTaskReceipt): Promise<SkillAuthoringValidationCurrentStatus>;
	/** Fails a Pending validation after its final unbound database claim expires. */
	failExpiredBeforeWorkload(validationId: string, task: IWorkflowTaskReceipt, claim: RuntimeWorkloadClaim): Promise<SkillAuthoringValidationRecoveryOutcome>;
	/** Binds a Job and bootstrap to the returned claim delivery. */
	bindWorkload(validationId: string, task: IWorkflowTaskReceipt, command: SkillAuthoringValidationWorkloadBindCommand): Promise<SkillAuthoringValidationBindOutcome>;
	/** Rechecks database time and the exact saved Job immediately before release. */
	authorizeRelease(validationId: string, task: IWorkflowTaskReceipt, binding: RuntimeWorkloadBinding): Promise<SkillAuthoringValidationReleaseOutcome>;
	/** Binds the first Job-owned Pod to the returned claim delivery. */
	bindFirstPod(validationId: string, task: IWorkflowTaskReceipt, command: SkillAuthoringValidationPodBindCommand): Promise<SkillAuthoringValidationBindOutcome>;
	/** Loads the current completion without accepting worker evidence from the controller. */
	loadCurrentCompletion(validationId: string, task: IWorkflowTaskReceipt): Promise<SkillAuthoringValidationCompletion | null>;
	/** Saves a terminal task-owned failure for a bound Job that cannot report a completion. */
	failUnreported(validationId: string, task: IWorkflowTaskReceipt, binding: RuntimeWorkloadBinding, reason: SkillAuthoringValidationRecoveryReasons): Promise<SkillAuthoringValidationRecoveryOutcome>;
	/** Applies the saved completion as the validation's terminal state. */
	complete(validationId: string, completion: SkillAuthoringValidationCompletion, task: IWorkflowTaskReceipt): Promise<"completed" | "idempotent" | "conflict">;
}
