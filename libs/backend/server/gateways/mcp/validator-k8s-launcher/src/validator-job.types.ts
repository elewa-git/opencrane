import type { V1ResourceRequirements } from "@kubernetes/client-node";

/**
 * Name a Kubernetes image-pull behaviour that the validator profile may supply.
 *
 * Used by: {@link McpbValidatorJobProfile}. Production has no caller yet. The builder accepts these
 * values only with a digest-pinned image; it never selects an image.
 */
export type McpbValidatorImagePullPolicy = "Always" | "IfNotPresent" | "Never";

/**
 * Describe the limits that the builder requires for every one-shot MCP bundle validator Job.
 *
 * Used by: `__BuildMcpbValidatorJob` in `validator-job.ts`. Production has no caller yet. The
 * builder throws before it returns a Job when a setting changes the worker identity, route,
 * resource bounds, scratch size, or lifetime.
 *
 * @see McpbValidatorJobAssignment
 */
export interface McpbValidatorJobProfile
{
	/** Immutable image that contains the validator program. */
	readonly image: string;
	/** Image pull behaviour for the immutable image. */
	readonly imagePullPolicy: McpbValidatorImagePullPolicy;
	/** Namespace where the OpenCrane server receives the worker's internal calls. */
	readonly serverNamespace: string;
	/** Dedicated namespace for MCP bundle validator Jobs. */
	readonly namespace: string;
	/** Exact ServiceAccount assigned to every validator Job. */
	readonly serviceAccountName: string;
	/** Audience of the sole projected token available to the worker. */
	readonly tokenAudience: string;
	/** Fixed internal endpoint where the worker exchanges its opaque reference. */
	readonly bootstrapUrl: string;
	/** Read-only path of the projected token. */
	readonly tokenPath: string;
	/** Read-only path of the opaque reference supplied by the controller. */
	readonly bootstrapReferencePath: string;
	/** Size of the temporary archive and inspection workspace. */
	readonly scratchSize: string;
	/** Maximum wall-clock runtime for one validator Job. */
	readonly activeDeadlineSeconds: number;
	/** Delay before Kubernetes removes a finished Job. */
	readonly ttlSecondsAfterFinished: number;
	/** CPU and memory requests and limits available to the worker. */
	readonly resources: V1ResourceRequirements;
}

/**
 * Carry the opaque coordinates that the builder places in one validator Job.
 *
 * Used by: `__BuildMcpbValidatorJob` in `validator-job.ts`. Production has no caller yet. The
 * builder hashes the silo and validation identifiers for the Job name and rejects a reference or
 * namespace that does not match its profile before it returns a Job.
 *
 * @see McpbValidatorJobProfile
 */
export interface McpbValidatorJobAssignment
{
	/** Opaque durable validation identifier; it is hashed before it becomes a Kubernetes name. */
	readonly validationId: string;
	/** Silo that owns the validation, retained only as trace metadata. */
	readonly siloId: string;
	/** Namespace selected by the deployment profile. */
	readonly namespace: string;
	/** Opaque reference that the worker presents with its projected token. */
	readonly bootstrapReference: string;
}
