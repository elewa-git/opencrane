import type { V1ResourceRequirements } from "@kubernetes/client-node";

/** Image pull behavior supported by the fixed warm runtime container. */
export type WarmRuntimeImagePullPolicy = "Always" | "IfNotPresent" | "Never";

/**
 * Defines one Helm-owned pool of generic agent runtime Pods.
 *
 * The profile fixes the image, namespace, Deployment, identity, and two network labels before the
 * controller starts. A workflow may select `claimedProfile`, but it cannot supply a container image
 * or turn the generic Pod into an OCI executor.
 */
export interface WarmRuntimePoolProfile
{
	/** Names the isolated namespace that contains this pool. */
	readonly namespace: string;
	/** Names the Helm-owned Deployment that replaces every deleted Pod. */
	readonly deploymentName: string;
	/** Names the credential-free ServiceAccount shared by generic pool Pods. */
	readonly serviceAccountName: string;
	/** Names the fixed low-privilege profile on an unclaimed Pod. */
	readonly genericProfile: string;
	/** Names the fixed network profile selected for this class of AgentRun. */
	readonly claimedProfile: string;
	/** Supplies the digest-pinned generic agent runtime image. */
	readonly image: string;
	/** Controls how Kubernetes obtains the pinned runtime image. */
	readonly imagePullPolicy: WarmRuntimeImagePullPolicy;
	/** Supplies the container port used for the binding and readiness exchange. */
	readonly bindingPort: number;
	/** Limits the time a generic Pod may wait before replacement. */
	readonly genericIdleSeconds: number;
	/** Supplies the throwaway scratch size for every Pod in this pool. */
	readonly scratchSize: string;
	/** Fixes CPU and memory requests and limits for every Pod in the pool. */
	readonly resources: V1ResourceRequirements;
}

/** Describes one generic Pod that the controller may offer for database reservation. */
export interface WarmRuntimePodCandidate
{
	/** Names the Pod inside its runtime namespace. */
	readonly podName: string;
	/** Carries the immutable Pod UID checked by every later command. */
	readonly podUid: string;
	/** Carries the resource version used by the conditional profile patch. */
	readonly resourceVersion: string;
	/** Carries the immutable UID of the Helm-owned pool Deployment. */
	readonly deploymentUid: string;
	/** Carries the Pod IP used for the readiness proof after policy activation. */
	readonly podIp: string;
}

/** Names the fields needed to delete one reserved or used Pod without deleting its replacement. */
export interface WarmRuntimePodIdentity
{
	/** Names the namespace containing the Pod. */
	readonly namespace: string;
	/** Names the Pod to read before deletion. */
	readonly podName: string;
	/** Carries the immutable UID used as the delete precondition. */
	readonly podUid: string;
	/** Carries the expected Deployment owner UID. */
	readonly deploymentUid: string;
	/** Carries the expected generic or claimed network profile. */
	readonly profile: string;
}
