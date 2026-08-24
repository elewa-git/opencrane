import type { V1ResourceRequirements } from "@kubernetes/client-node";

/** Kubernetes image pull behaviour allowed for the immutable validator image. */
export type McpbValidatorImagePullPolicy = "Always" | "IfNotPresent" | "Never";

/** Deployment-owned settings that bound every one-shot MCP bundle validator Job. */
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

/** Controller-owned coordinates for one database-admitted validator Job. */
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
