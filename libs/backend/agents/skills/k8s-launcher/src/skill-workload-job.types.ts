import type { V1ResourceRequirements } from "@kubernetes/client-node";

/** The two isolated Python workload classes owned by the governed-skill plane. */
export type SkillWorkloadKind = "authoring" | "tool-runner";

/** Kubernetes image pull behaviour accepted for a governed skill workload. */
export type SkillWorkloadImagePullPolicy = "Always" | "IfNotPresent" | "Never";

/** Deployment-owned limits applied to one isolated governed-skill Job class. */
export interface SkillWorkloadJobProfile
{
	/** Fixed workload class selecting the identity grammar and component label. */
	readonly kind: SkillWorkloadKind;
	/** Immutable digest-pinned Python worker image. */
	readonly image: string;
	/** Kubernetes image pull policy for the immutable worker image. */
	readonly imagePullPolicy: SkillWorkloadImagePullPolicy;
	/** OpenCrane server namespace, which must differ from the isolated Job namespace. */
	readonly serverNamespace: string;
	/** Exact deployment-owned namespace for this workload class. */
	readonly namespace: string;
	/** Bounded, zero-RBAC ServiceAccount for this exact Job class. */
	readonly serviceAccountName: string;
	/** Audience for the sole projected capability token mounted into the Job. */
	readonly capabilityTokenAudience: string;
	/** Bounded non-authoritative scratch volume quantity. */
	readonly scratchSize: string;
	/** Maximum wall-clock lifetime of the one-shot Job. */
	readonly activeDeadlineSeconds: number;
	/** Terminal cleanup delay, which must be zero for untrusted scratch. */
	readonly ttlSecondsAfterFinished: number;
	/** CPU and memory requests and limits for the Job container. */
	readonly resources: V1ResourceRequirements;
}

/** Durable coordinates that become one deterministic governed-skill Kubernetes Job. */
export interface SkillWorkloadJobAssignment
{
	/** Stable opaque authority id for this one Job attempt. */
	readonly jobId: string;
	/** ClusterTenant silo containing every durable authority fact. */
	readonly siloId: string;
	/** Dedicated namespace selected by the controller for this job class. */
	readonly namespace: string;
	/** Opaque, non-secret reference that the worker exchanges for its exact capability. */
	readonly capabilityReference: string;
}
