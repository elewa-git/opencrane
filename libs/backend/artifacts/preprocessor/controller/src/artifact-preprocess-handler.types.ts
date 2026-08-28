import type { V1Job, V1Pod } from "@kubernetes/client-node";

import type { ArtifactPreprocessCompletion, ArtifactPreprocessControllerAuthority, ArtifactPreprocessTaskInput } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import type { GovernedJobObservation } from "@opencrane/backend/agents/runtime/workloads/k8s-controller";
import type { ArtifactPreprocessorJobProfile } from "@opencrane/backend/artifacts/preprocessor/k8s-launcher";
import type { IWorkflowTaskContext, IWorkflowTaskDefinition } from "@opencrane/backend/server/infra/workflows/contract";

/**
 * Defines the Kubernetes operations the controller may perform for a task-bound PDF Job.
 *
 * Each operation receives the expected Job or its immutable UID. This keeps the controller from
 * creating, releasing, or reading a different workload while it acts on a server-issued claim.
 */
export interface ArtifactPreprocessKubernetesStore
{
	/**
	 * Creates or adopts the suspended Job built from the fixed deployment profile.
	 *
	 * @param expected - Hardened Job manifest for the claim the server issued.
	 * @returns The Kubernetes Job, including the UID needed before release.
	 */
	ensureSuspendedJob(expected: V1Job): Promise<V1Job>;
	/**
	 * Releases the Job whose UID the server has accepted for this claim.
	 *
	 * @param expected - Same hardened Job manifest used for adoption.
	 * @param jobUid - Immutable UID returned by Kubernetes and bound through the server authority.
	 * @param claimExpiresAt - Server-issued deadline after which this delivery must not run.
	 * @returns The released Kubernetes Job.
	 */
	releaseJob(expected: V1Job, jobUid: string, claimExpiresAt: string): Promise<V1Job>;
	/**
	 * Finds the first Pod owned by the released Job.
	 *
	 * @param expected - Same hardened Job manifest used for adoption.
	 * @param jobUid - Immutable UID of the released Job.
	 * @param serviceAccountName - Worker identity that the Pod must use.
	 * @returns The first matching Pod, or `null` while Kubernetes has not created one.
	 */
	findFirstPod(expected: V1Job, jobUid: string, serviceAccountName: string): Promise<V1Pod | null>;
	/** Returns the verified lifecycle state of the exact released Job. */
	observeJob(expected: V1Job, jobUid: string): Promise<GovernedJobObservation>;
	/**
	 * Deletes the exact completed Job through its saved immutable UID.
	 *
	 * @param expected - Same hardened Job manifest used for creation and release.
	 * @param jobUid - Immutable UID accepted by the server for this workflow claim.
	 * @returns Nothing after deletion or when Kubernetes already reports the Job missing.
	 */
	deleteJob(expected: V1Job, jobUid: string): Promise<void>;
}

/**
 * Configures the controller handler with server persistence, Kubernetes operations, and its Job profile.
 *
 * Composition supplies these trusted dependencies once. The handler cannot replace the server
 * authority, worker identity, or resource policy from workflow input.
 */
export interface ArtifactPreprocessHandlerOptions
{
	/** Server authority that issues claims and records the Job and Pod bindings. */
	readonly authority: ArtifactPreprocessControllerAuthority;
	/** Kubernetes port limited to the task's isolated PDF Job class. */
	readonly kubernetes: ArtifactPreprocessKubernetesStore;
	/** Deployment-owned image, namespace, identity, and resource policy for PDF jobs. */
	readonly profile: ArtifactPreprocessorJobProfile;
	/** Delay between attempts to observe the first Pod after release. */
	readonly podWaitMilliseconds: number;
}

/**
 * Reports the PDF preprocessing job whose server-owned completion the controller applied.
 *
 * This does not contain PDF conversion output. The digest identifies the completion inbox entry
 * the controller reloaded before it made the job terminal.
 */
export interface ArtifactPreprocessTaskResult
{
	/** Names the PDF preprocessing job the controller completed. */
	readonly preprocessJobId: string;
	/** Identifies the server-owned completion the controller applied. */
	readonly completionDigest: string;
}

/** Narrows the workflow operations the controller handler needs for durable steps and recovery sleeps. */
export type ArtifactPreprocessTaskContext = Pick<IWorkflowTaskContext, "checkpoint" | "sleepUntil" | "task">;

/** Re-exports the completion identity shared by the controller task result and authority calls. */
export type { ArtifactPreprocessCompletion };

/**
 * Builds the controller task definition that binds one PDF preprocessing Job and applies its completion.
 *
 * Application composition may register the returned definition only after it provides the server
 * authority and Kubernetes adapter described by {@link ArtifactPreprocessHandlerOptions}.
 */
export type CreateArtifactPreprocessHandler = (options: ArtifactPreprocessHandlerOptions) => IWorkflowTaskDefinition<ArtifactPreprocessTaskInput, ArtifactPreprocessTaskResult>;
