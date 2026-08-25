import type { V1Job, V1Pod } from "@kubernetes/client-node";

import type { SkillAuthoringValidationTaskInput } from "@opencrane/backend/agents/skills/workflows/contract";
import type { SkillAuthoringValidationControllerAuthority } from "@opencrane/backend/agents/skills/workflows/contract";
import type { SkillWorkloadJobProfile } from "@opencrane/backend/agents/skills/k8s-launcher";
import type { IWorkflowTaskContext, IWorkflowTaskDefinition } from "@opencrane/backend/server/infra/workflows/contract";

export type { SkillAuthoringValidationCompletion, SkillAuthoringValidationControllerAuthority, SkillAuthoringValidationControllerRecord, SkillAuthoringValidationPodBindCommand, SkillAuthoringValidationWorkloadBindCommand } from "@opencrane/backend/agents/skills/workflows/contract";

/** Reports the completion that the handler loaded and asked the server to apply. */
export interface SkillAuthoringValidationTaskResult
{
	/** Names the validation whose completion the handler applied. */
	readonly validationId: string;
	/** Identifies the completion inbox entry the handler applied. */
	readonly completionDigest: string;
}

/** Defines the Kubernetes actions the authoring task may ask the controller to perform. */
export interface SkillAuthoringValidationKubernetesStore
{
	/** Creates the suspended authoring Job or adopts the matching Job after a controller restart. */
	ensureSuspendedJob(expected: V1Job): Promise<V1Job>;
	/** Releases the assigned Job after the server has recorded its UID and bootstrap reference. */
	releaseJob(expected: V1Job, jobUid: string): Promise<V1Job>;
	/** Returns the first Pod owned by the Job, or null while Kubernetes has not created one. */
	findFirstPod(expected: V1Job, jobUid: string, serviceAccountName: string): Promise<V1Pod | null>;
}

/** Configures the controller-hosted task for a Python authoring validation. */
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

/** Builds the workflow definition that runs one Python authoring validation. */
export type CreateSkillAuthoringValidationHandler = (options: SkillAuthoringValidationHandlerOptions) => IWorkflowTaskDefinition<SkillAuthoringValidationTaskInput, SkillAuthoringValidationTaskResult>;

/** Narrows the workflow context to the checkpoint, delay, task identity, and private-event operations this handler uses. */
export type SkillAuthoringValidationTaskContext = Pick<IWorkflowTaskContext, "checkpoint" | "sleepUntil" | "task" | "waitForEvent">;
