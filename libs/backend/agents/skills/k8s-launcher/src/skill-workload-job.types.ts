import type { V1ResourceRequirements } from "@kubernetes/client-node";

/**
 * The two workload classes, as stored in the database.
 *
 * The class decides which ServiceAccount, token audience, image, and component label a Job gets.
 * A worker cannot change it: neither the job id nor the bootstrap reference can select a class.
 */
export enum SkillWorkloadKinds
{
	/** Worker that authors and validates a skill offline. It needs more memory and scratch than the tool runner. */
	Authoring = "authoring",
	/** Tenant-authored tool execution worker with its distinct ServiceAccount and token audience. */
	ToolRunner = "tool-runner",
}

/** The two serialized workload classes accepted by a deployment-owned Job profile. */
export type SkillWorkloadKind = `${SkillWorkloadKinds}`;

/**
 * Kubernetes image pull behaviour accepted for a governed skill workload.
 *
 * The image itself is always digest-pinned; this only controls whether Kubernetes reuses an
 * already-verified local copy of that immutable image.
 */
export type SkillWorkloadImagePullPolicy = "Always" | "IfNotPresent" | "Never";

/**
 * Settings from the Helm chart that go into every Job of one workload class.
 *
 * The controller reads the profile from trusted deployment configuration. The builder still checks it
 * again, because the manifest is a security boundary: a malformed profile must never widen the
 * worker's ServiceAccount, its network destination, its lifetime, or its CPU and memory limits.
 */
export interface SkillWorkloadJobProfile
{
	/** Workload class. It decides the ServiceAccount name, the token audience, and the component label. */
	readonly kind: SkillWorkloadKind;
	/** Immutable digest-pinned Python worker image; mutable tags are rejected before projection. */
	readonly image: string;
	/** Kubernetes pull behaviour for the immutable worker image, not a mechanism to select an image. */
	readonly imagePullPolicy: SkillWorkloadImagePullPolicy;
	/** OpenCrane server namespace, required to differ from the isolated Job namespace. */
	readonly serverNamespace: string;
	/** Namespace for this Job class, set by the Helm chart. The assignment must name the same one. */
	readonly namespace: string;
	/** Expected ServiceAccount name for this Job class, never a controller or server identity; its RBAC is chart-owned. */
	readonly serviceAccountName: string;
	/** Audience of the sole short-lived projected token mounted into the Job. */
	readonly capabilityTokenAudience: string;
	/** Fixed cluster-local internal endpoint where the worker may acknowledge its bootstrap and nothing else. */
	readonly bootstrapUrl: string;
	/** Fixed read-only path of the projected token, so a worker cannot ask for a different token. */
	readonly capabilityTokenPath: string;
	/** Fixed read-only path of the opaque downward-API reference; it is not a capability or secret. */
	readonly bootstrapReferencePath: string;
	/** Size of the temporary scratch volume. It is deleted with the Pod and is never tenant storage. */
	readonly scratchSize: string;
	/** Maximum wall-clock lifetime of the one-shot Job, after which Kubernetes terminates it. */
	readonly activeDeadlineSeconds: number;
	/** Delay before Kubernetes deletes the finished Job. It must stay zero, so the untrusted scratch volume goes away as soon as the Job finishes. */
	readonly ttlSecondsAfterFinished: number;
	/** CPU and memory requests and limits; requests cannot exceed limits and both remain class-bounded. */
	readonly resources: V1ResourceRequirements;
}

/**
 * The ids the controller puts into one skill Job.
 *
 * They point at an assignment the database already authorised. They do not authorise anything
 * themselves: the internal bootstrap route still checks the worker's projected token, its class, its
 * namespace, and the stored assignment before it accepts any request.
 */
export interface SkillWorkloadJobAssignment
{
	/** Stable controller-owned id for this one Job attempt; hashed before it becomes a resource name. */
	readonly jobId: string;
	/** ClusterTenant silo that owns this workload. Stored as a Job annotation, for tracing only. */
	readonly siloId: string;
	/** Dedicated namespace selected by the controller; it must exactly match the deployment profile. */
	readonly namespace: string;
	/** Reference the worker trades for its capability. It is not a secret, and it reveals no workload id. */
	readonly capabilityReference: string;
}
