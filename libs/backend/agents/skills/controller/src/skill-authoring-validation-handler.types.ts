import type { V1Job, V1Pod } from "@kubernetes/client-node";

import type { SkillAuthoringValidationTaskInput } from "@opencrane/backend/agents/skills/workflows/contract";
import type { SkillWorkloadJobProfile } from "@opencrane/backend/agents/skills/k8s-launcher";
import type { IWorkflowTaskContext, IWorkflowTaskDefinition, IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

/**
 * Carries the server-owned facts the controller needs to build an authoring Job.
 *
 * The authority returns this record only after it checks the task receipt and silo, which prevents
 * a stale task from acting on a different validation.
 */
export interface SkillAuthoringValidationControllerRecord
{
	/** Names the validation selected by the server when it admitted this task. */
	readonly validationId: string;
	/** Names the silo that owns both the Draft skill revision and its isolated Job. */
	readonly siloId: string;
	/** Supplies the stable value used in the opaque Kubernetes Job name. */
	readonly jobId: string;
}

/**
 * Carries the Job facts that the server persists before the controller releases the Job.
 *
 * Binding the Kubernetes UID and bootstrap reference first prevents a worker from using an
 * unrecorded Job identity.
 */
export interface SkillAuthoringValidationJobRecordCommand
{
	/** Identifies the Job that Kubernetes created or the controller adopted. */
	readonly jobUid: string;
	/** Supplies the opaque reference the worker must exchange before it can read its input. */
	readonly bootstrapReference: string;
	/** Names the namespace selected by the deployment-owned authoring Job profile. */
	readonly namespace: string;
}

/**
 * Carries the first Pod Kubernetes created for the recorded Job.
 *
 * The server records this Pod before worker completion can be accepted, so the bootstrap reference
 * is tied to a Job-owned worker.
 */
export interface SkillAuthoringValidationPodRecordCommand
{
	/** Identifies the Job already bound to this validation. */
	readonly jobUid: string;
	/** Identifies the first worker Pod created for that Job. */
	readonly podUid: string;
}

/**
 * Identifies a completion the server saved before it wakes the workflow task.
 *
 * The handler reloads this inbox entry rather than trusting the event payload, then asks the server
 * to make the terminal write for the validation.
 */
export interface SkillAuthoringValidationCompletion
{
	/** Names the validation that owns this completion inbox entry. */
	readonly validationId: string;
	/** Identifies the receipt the server saved before it published the private wake-up event. */
	readonly completionDigest: string;
}

/**
 * Reports the completion that the handler loaded and asked the server to apply.
 *
 * Returning this result means the persisted completion reached the server-owned terminal write;
 * the caller can use its digest to identify the completion inbox entry.
 */
export interface SkillAuthoringValidationTaskResult
{
	/** Names the validation whose completion the handler applied. */
	readonly validationId: string;
	/** Identifies the completion inbox entry the handler applied. */
	readonly completionDigest: string;
}

/**
 * Defines the server-owned reads and writes that the remote controller task may request.
 *
 * The controller uses this port for product rows, bootstrap state, the completion inbox, and the
 * terminal write. It supplies Kubernetes facts for the server to persist; it does not own product
 * records itself.
 */
export interface SkillAuthoringValidationControllerAuthority
{
	/** Loads the validation when its task receipt and silo still match the saved product record. */
	load(validationId: string, task: IWorkflowTaskReceipt): Promise<SkillAuthoringValidationControllerRecord | null>;
	/** Records the Job identity and bootstrap reference before the controller releases the Job. */
	recordJob(validationId: string, task: IWorkflowTaskReceipt, command: SkillAuthoringValidationJobRecordCommand): Promise<"recorded" | "idempotent">;
	/** Records the first Job-owned Pod before the worker can complete this validation. */
	recordPod(validationId: string, task: IWorkflowTaskReceipt, command: SkillAuthoringValidationPodRecordCommand): Promise<"recorded" | "idempotent">;
	/** Reloads the persisted completion inbox entry after the task receives its private wake-up event. */
	loadCompletion(validationId: string, completionDigest: string, task: IWorkflowTaskReceipt): Promise<SkillAuthoringValidationCompletion | null>;
	/** Applies the saved completion as the terminal writer of skill-review evidence and state. */
	complete(validationId: string, completion: SkillAuthoringValidationCompletion, task: IWorkflowTaskReceipt): Promise<"completed" | "idempotent">;
}

/**
 * Defines the Kubernetes actions the authoring task may ask the controller to perform.
 *
 * This narrow port makes the controller the Job mutator: it creates or adopts a suspended Job,
 * releases it after the server records its UID, and identifies the first Pod it owns.
 */
export interface SkillAuthoringValidationKubernetesStore
{
	/** Creates the suspended authoring Job or adopts the matching Job after a controller restart. */
	ensureSuspendedJob(expected: V1Job): Promise<V1Job>;
	/** Releases the assigned Job after the server has recorded its UID and bootstrap reference. */
	releaseJob(expected: V1Job, jobUid: string): Promise<V1Job>;
	/** Returns the first Pod owned by the Job, or null while Kubernetes has not created one. */
	findFirstPod(expected: V1Job, jobUid: string, serviceAccountName: string): Promise<V1Pod | null>;
}

/**
 * Configures the controller-hosted task for a Python authoring validation.
 *
 * The options keep server authority separate from Kubernetes mutation and pass the deployment-owned
 * profile into the task definition.
 */
export interface SkillAuthoringValidationHandlerOptions
{
	/** Supplies the server authority that owns the validation row, bootstrap, inbox, outbox, and terminal write. */
	readonly authority: SkillAuthoringValidationControllerAuthority;
	/** Supplies the controller Kubernetes adapter, which mutates authoring Jobs. */
	readonly kubernetes: SkillAuthoringValidationKubernetesStore;
	/** Supplies the deployment-owned profile for the supported Python authoring Job class. */
	readonly profile: SkillWorkloadJobProfile;
	/** Sets the delay before the task checks again for the Job's first Pod. */
	readonly podWaitMilliseconds: number;
}

/**
 * Builds the workflow definition that runs one Python authoring validation.
 *
 * The returned definition lets the controller register the shared declaration while keeping the
 * server responsible for transactional admission.
 */
export type CreateSkillAuthoringValidationHandler = (options: SkillAuthoringValidationHandlerOptions) => IWorkflowTaskDefinition<SkillAuthoringValidationTaskInput, SkillAuthoringValidationTaskResult>;

/** Narrows the workflow context to the checkpoint, delay, task identity, and private-event operations this handler uses. */
export type SkillAuthoringValidationTaskContext = Pick<IWorkflowTaskContext, "checkpoint" | "sleepUntil" | "task" | "waitForEvent">;
