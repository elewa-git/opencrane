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
	/** Runs as a person's own identity, and cannot reach the managed connectors. The default when a profile omits the field. */
	Personal = "personal",
	/** Runs as a managed identity, limited to the connectors configured for it, with its own token audience. */
	Managed = "managed",
}

/**
 * Everything a runtime Job needs that is not specific to one run: image, identity, endpoints, and
 * limits. One profile is shared by every attempt of its identity class.
 *
 * Supplied by the deployment as JSON and validated once at startup, then never changed. Because
 * profiles are checked by actually building a Job from them, a field added here must be one
 * {@link _AssertAgentRuntimeJobProfile} knows how to bound.
 * @see {@link __ValidateAgentControllerRuntimeProfiles}
 */
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
	/** ServiceAccount the runtime Pod runs as. Its name must match this profile's identity class, or validation rejects the profile. */
	readonly serviceAccountName: string;
	/** Projected ServiceAccount token lifetime in seconds. */
	readonly projectedTokenTtlSeconds: number;
	/** Size of the throwaway scratch volume, as a binary Kubernetes quantity such as `64Mi`; 1 GiB at most. */
	readonly scratchSize: string;
	/** Longest an attempt may run under this profile. Release lowers it further so the Job cannot outlive the assignment, and never raises it. */
	readonly activeDeadlineSeconds: number;
	/** Cleanup delay after terminal state; must be zero so ephemeral scratch is not retained. */
	readonly ttlSecondsAfterFinished: number;
	/** Runtime container requests and limits. */
	readonly resources: V1ResourceRequirements;
}

/**
 * The recorded run details that one attempt's Job is built from.
 *
 * Every field arrives from OpenCrane and ends up in the Job's name, labels, or annotations, which
 * is why they are all validated before use: they cross from the database into Kubernetes metadata,
 * where a stray character or an over-long value would be rejected by the API server or, worse,
 * silently change which object is addressed.
 * @see {@link _AssertAgentRuntimeJobAssignment}
 */
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
