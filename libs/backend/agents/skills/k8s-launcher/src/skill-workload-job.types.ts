import type { V1ResourceRequirements } from "@kubernetes/client-node";

/**
 * Stable serialized workload-class values owned by the governed-skill plane.
 *
 * This discriminant selects a deliberately separate deployment identity, token audience, image,
 * and component label. It is not an instruction from the worker and therefore cannot be changed
 * by a durable job coordinate or bootstrap reference.
 */
export enum SkillWorkloadKinds
{
	/** Offline authoring and validation worker with its larger fixed extraction resource floor. */
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
 * Deployment-owned policy projected into every isolated Job of one workload class.
 *
 * The controller supplies a profile from trusted deployment configuration. The builder validates
 * it again because a manifest is a security boundary: a malformed profile must never broaden the
 * worker's identity, network destination, lifetime, or resource envelope.
 */
export interface SkillWorkloadJobProfile
{
	/** Fixed class that selects its distinct identity grammar, token audience, and component label. */
	readonly kind: SkillWorkloadKind;
	/** Immutable digest-pinned Python worker image; mutable tags are rejected before projection. */
	readonly image: string;
	/** Kubernetes pull behaviour for the immutable worker image, not a mechanism to select an image. */
	readonly imagePullPolicy: SkillWorkloadImagePullPolicy;
	/** OpenCrane server namespace, required to differ from the isolated Job namespace. */
	readonly serverNamespace: string;
	/** Exact deployment-owned namespace for this Job class; assignment input may only repeat it. */
	readonly namespace: string;
	/** Expected ServiceAccount name for this Job class, never a controller or server identity; its RBAC is chart-owned. */
	readonly serviceAccountName: string;
	/** Audience of the sole short-lived projected token mounted into the Job. */
	readonly capabilityTokenAudience: string;
	/** Fixed cluster-local internal endpoint where the worker may acknowledge its bootstrap and nothing else. */
	readonly bootstrapUrl: string;
	/** Fixed read-only path of the projected token; it prevents a worker argument from selecting a token. */
	readonly capabilityTokenPath: string;
	/** Fixed read-only path of the opaque downward-API reference; it is not a capability or secret. */
	readonly bootstrapReferencePath: string;
	/** Bounded ephemeral non-authoritative scratch volume quantity; it is never durable tenant storage. */
	readonly scratchSize: string;
	/** Maximum wall-clock lifetime of the one-shot Job, after which Kubernetes terminates it. */
	readonly activeDeadlineSeconds: number;
	/** Terminal cleanup delay, which must remain zero so Kubernetes may clean up untrusted scratch after it observes completion. */
	readonly ttlSecondsAfterFinished: number;
	/** CPU and memory requests and limits; requests cannot exceed limits and both remain class-bounded. */
	readonly resources: V1ResourceRequirements;
}

/**
 * Durable controller coordinates that become one deterministic governed-skill Kubernetes Job.
 *
 * These values identify the already-authorized assignment. They do not authorize the Job: the
 * internal bootstrap route still verifies the projected token, class, namespace, and durable
 * assignment before it accepts any worker request.
 */
export interface SkillWorkloadJobAssignment
{
	/** Stable controller-owned id for this one Job attempt; hashed before it becomes a resource name. */
	readonly jobId: string;
	/** ClusterTenant silo containing every durable authority fact; retained as bounded trace metadata. */
	readonly siloId: string;
	/** Dedicated namespace selected by the controller; it must exactly match the deployment profile. */
	readonly namespace: string;
	/** Opaque non-secret reference exchanged for the exact capability; it cannot expose a readable workload id. */
	readonly capabilityReference: string;
}
