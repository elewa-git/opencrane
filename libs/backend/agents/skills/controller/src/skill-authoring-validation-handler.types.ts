import type { V1Job, V1Pod } from "@kubernetes/client-node";

import type { SkillWorkloadJobProfile } from "@opencrane/backend/agents/skills/k8s-launcher";
import type { IWorkflowTaskContext, IWorkflowTaskDefinition, IWorkflowTaskReceipt, IWorkflowTaskRetryPolicy } from "@opencrane/backend/server/infra/workflows/contract";

/** Names the remote durable task that validates one Draft Python skill revision. */
export enum SkillAuthoringValidationTaskNames
{
	/** Runs the isolated authoring Job and records its final review evidence. */
	Validate = "skills.authoring.validate/v1",
}

/** Identifies one server-admitted authoring validation without carrying artifact bytes or credentials. */
export interface SkillAuthoringValidationTaskInput
{
	/** Silo that owns both the saved validation and the workflow task. */
	readonly siloId: string;
	/** Stable product record that binds the task to one Draft Python skill revision. */
	readonly validationId: string;
}

/** Describes the saved validation facts the controller needs before it can create a Kubernetes Job. */
export interface SkillAuthoringValidationControllerRecord
{
	/** Stable product record selected by the server when it admitted this task. */
	readonly validationId: string;
	/** Silo that owns the Draft skill revision and the isolated Job. */
	readonly siloId: string;
	/** Stable id used for the opaque Kubernetes Job name. */
	readonly jobId: string;
}

/** Carries the exact Job coordinates that the server binds to the saved validation. */
export interface SkillAuthoringValidationJobRecordCommand
{
	/** Kubernetes-issued immutable UID for the Job the controller created or adopted. */
	readonly jobUid: string;
	/** Hashed opaque reference that the worker must exchange before reading its input. */
	readonly bootstrapReference: string;
	/** Namespace selected by the deployment-owned authoring Job profile. */
	readonly namespace: string;
}

/** Carries the first Job-owned Pod that may use the saved bootstrap reference. */
export interface SkillAuthoringValidationPodRecordCommand
{
	/** Kubernetes-issued immutable UID for the Job already bound to this validation. */
	readonly jobUid: string;
	/** Kubernetes-issued immutable UID for the only worker Pod the Job created. */
	readonly podUid: string;
}

/** Identifies a persisted completion received from the isolated authoring worker. */
export interface SkillAuthoringValidationCompletion
{
	/** Validation record that owns this completion inbox entry. */
	readonly validationId: string;
	/** Digest of the bounded receipt stored by the server before it wakes the task. */
	readonly completionDigest: string;
}

/** Result returned once the workflow handler becomes the sole terminal writer. */
export interface SkillAuthoringValidationTaskResult
{
	/** Validation record that the handler completed or failed. */
	readonly validationId: string;
	/** Receipt digest that identifies the inbox entry the handler applied. */
	readonly completionDigest: string;
}

/** Provides the server-owned product reads and writes that the remote controller task may use. */
export interface SkillAuthoringValidationControllerAuthority
{
	/** Load a validation only when its task receipt and silo still match the saved product record. */
	load(validationId: string, task: IWorkflowTaskReceipt): Promise<SkillAuthoringValidationControllerRecord | null>;
	/** Bind the immutable Kubernetes Job UID and worker bootstrap reference to one validation. */
	recordJob(validationId: string, task: IWorkflowTaskReceipt, command: SkillAuthoringValidationJobRecordCommand): Promise<"recorded" | "idempotent">;
	/** Bind the one Job-owned Pod whose projected token may consume the bootstrap reference. */
	recordPod(validationId: string, task: IWorkflowTaskReceipt, command: SkillAuthoringValidationPodRecordCommand): Promise<"recorded" | "idempotent">;
	/** Re-read the persisted completion inbox after the task receives its private wake-up event. */
	loadCompletion(validationId: string, completionDigest: string, task: IWorkflowTaskReceipt): Promise<SkillAuthoringValidationCompletion | null>;
	/** Apply the saved completion as the sole writer of skill-review evidence and terminal state. */
	complete(validationId: string, completion: SkillAuthoringValidationCompletion, task: IWorkflowTaskReceipt): Promise<"completed" | "idempotent">;
}

/** Limits the Kubernetes actions that the durable authoring task may ask the agent controller to perform. */
export interface SkillAuthoringValidationKubernetesStore
{
	/** Create one suspended authoring Job, or adopt the matching Job after a restart. */
	ensureSuspendedJob(expected: V1Job): Promise<V1Job>;
	/** Unsuspend the assigned Job after the server has recorded its immutable UID and bootstrap reference. */
	releaseJob(expected: V1Job, jobUid: string): Promise<V1Job>;
	/** Return the only Pod owned by the Job, or null while Kubernetes has not created it. */
	findFirstPod(expected: V1Job, jobUid: string, serviceAccountName: string): Promise<V1Pod | null>;
}

/** Configures the controller-hosted handler for the single Python authoring validation pilot. */
export interface SkillAuthoringValidationHandlerOptions
{
	/** Server authority that owns the validation row, bootstrap, inbox, outbox, and terminal write. */
	readonly authority: SkillAuthoringValidationControllerAuthority;
	/** Kubernetes adapter supplied by the agent controller, the sole Job mutator. */
	readonly kubernetes: SkillAuthoringValidationKubernetesStore;
	/** Immutable deployment profile for the one supported Python authoring Job class. */
	readonly profile: SkillWorkloadJobProfile;
	/** Delay before checking again for the Job's first Pod. */
	readonly podWaitMilliseconds: number;
	/** Retry policy registered with the workflow engine for transient controller or Kubernetes failures. */
	readonly retryPolicy: IWorkflowTaskRetryPolicy;
}

/** Builds the registered workflow definition that runs one Python authoring validation. */
export type CreateSkillAuthoringValidationHandler = (options: SkillAuthoringValidationHandlerOptions) => IWorkflowTaskDefinition<SkillAuthoringValidationTaskInput, SkillAuthoringValidationTaskResult>;

/** Narrows the workflow context used by the handler's private event wait. */
export type SkillAuthoringValidationTaskContext = Pick<IWorkflowTaskContext, "checkpoint" | "sleepUntil" | "task" | "waitForEvent">;
