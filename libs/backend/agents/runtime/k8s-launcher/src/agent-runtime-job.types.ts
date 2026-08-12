import type { V1ResourceRequirements } from "@kubernetes/client-node";

/** Image pull behavior supported by Kubernetes containers. */
export type AgentRuntimeImagePullPolicy = "Always" | "IfNotPresent" | "Never";

/**
 * Selectable identity and workload classes projected by runtime release profiles.
 *
 * These stable values select both ServiceAccount grammar and token audience. They grant no
 * authority by themselves; the controller still binds the selected profile to a durable claim.
 */
export enum AgentRuntimeIdentityProfiles
{
	/** Personal runtime identity without managed connector reach. */
	Personal = "personal",
	/** Managed runtime identity limited to its configured connector plane. */
	Managed = "managed",
}

/** Immutable release profile applied to every runtime attempt Job of one identity class. */
export interface AgentRuntimeJobProfile
{
	/**
	 * Identity/workload class this profile projects. Selects the ServiceAccount validator and the
	 * projected-token audience; personal and managed are mutually exclusive. Defaults to `personal`
	 * when absent so existing personal-runtime profiles keep their exact behaviour.
	 */
	readonly identityProfile?: AgentRuntimeIdentityProfiles;
	/** Immutable runtime image reference pinned by a SHA-256 digest. */
	readonly image: string;
	/** Kubernetes image pull behavior. */
	readonly imagePullPolicy: AgentRuntimeImagePullPolicy;
	/** Internal OpenCrane runtime-stream endpoint. */
	readonly runtimeStreamUrl: string;
	/** In-cluster LiteLLM proxy base URL the runtime reaches with its attempt-scoped key. */
	readonly litellmBaseUrl: string;
	/** OpenCrane server namespace, which must differ from the runtime Job namespace. */
	readonly serverNamespace: string;
	/** Bounded runtime-profile ServiceAccount selected by the controller. */
	readonly serviceAccountName: string;
	/** Projected ServiceAccount token lifetime in seconds. */
	readonly projectedTokenTtlSeconds: number;
	/** Non-durable binary scratch quantity, capped at 1 GiB. */
	readonly scratchSize: string;
	/** Maximum wall-clock lifetime of one attempt before the assignment-specific release cap. */
	readonly activeDeadlineSeconds: number;
	/** Cleanup delay after terminal state; must be zero so ephemeral scratch is not retained. */
	readonly ttlSecondsAfterFinished: number;
	/** Runtime container requests and limits. */
	readonly resources: V1ResourceRequirements;
}

/** Durable assignment coordinates used to derive one deterministic attempt workload. */
export interface AgentRuntimeJobAssignment
{
	/** Logical run identifier. */
	readonly runId: string;
	/** Positive attempt number within the logical run. */
	readonly attempt: number;
	/** Stable AgentService identifier executed by this attempt. */
	readonly agentServiceId: string;
	/** Immutable AgentRevision identifier executed by this attempt. */
	readonly agentRevisionId: string;
	/** Silo authority containing the run. */
	readonly siloId: string;
	/** Kubernetes namespace selected for the attempt. */
	readonly namespace: string;
	/** Opaque, non-secret reference to the one-use bootstrap held by OpenCrane. */
	readonly bootstrapReference: string;
	/** Name of the per-attempt Secret holding the attempt-scoped LiteLLM virtual key. */
	readonly litellmKeySecretName: string;
}
