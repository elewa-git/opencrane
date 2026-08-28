import type { V1ResourceRequirements } from "@kubernetes/client-node";

/**
 * Names the image-pull setting carried by the PDF worker manifest.
 *
 * The profile must supply one of these Kubernetes values; the builder rejects any other policy
 * while it validates the immutable worker image.
 */
export type ArtifactPreprocessorImagePullPolicy = "Always" | "IfNotPresent" | "Never";

/**
 * Defines the deployment-owned policy for every one-shot PDF preprocessing Job.
 *
 * The builder checks these values before it returns a manifest, preventing a controller task from
 * selecting its own identity, broker endpoint, token files, or resource limit. The profile is not
 * sent by a worker and does not contain a PDF, bootstrap reference, or database credential.
 */
export interface ArtifactPreprocessorJobProfile
{
	/** Immutable digest-pinned PDF worker image. */
	readonly image: string;
	/** Kubernetes pull behaviour for the immutable image. */
	readonly imagePullPolicy: ArtifactPreprocessorImagePullPolicy;
	/** Trusted server namespace, which must differ from the isolated worker namespace. */
	readonly serverNamespace: string;
	/** Exact internal Service name that owns the broker endpoint. */
	readonly serverServiceName: string;
	/** Isolated namespace where this worker class runs. */
	readonly namespace: string;
	/** Fixed zero-RBAC worker ServiceAccount. */
	readonly serviceAccountName: string;
	/** Sole projected-token audience accepted by the internal PDF broker. */
	readonly tokenAudience: string;
	/** Fixed cluster-local OpenCrane origin used by the broker-only worker. */
	readonly openCraneInternalUrl: string;
	/** Read-only path where the projected token is mounted. */
	readonly tokenPath: string;
	/** Read-only path where the opaque bootstrap reference is mounted. */
	readonly bootstrapReferencePath: string;
	/** Bounded temporary filesystem size for source and output files. */
	readonly scratchSize: string;
	/** Maximum wall-clock lifetime of the one-shot Job. */
	readonly activeDeadlineSeconds: number;
	/** CPU and memory requests and limits. */
	readonly resources: V1ResourceRequirements;
}

/**
 * Carries the controller-selected coordinates for one PDF preprocessing task.
 *
 * The builder hashes the job ID into metadata and requires the namespace to match the deployment
 * profile. The opaque bootstrap reference reaches the worker through a read-only file; it is not a
 * credential by itself.
 */
export interface ArtifactPreprocessorJobAssignment
{
	/** Saved preprocessing record identifier. It is hashed before it becomes a Kubernetes name. */
	readonly preprocessJobId: string;
	/** Silo that owns the source PDF. Used only for trace metadata. */
	readonly siloId: string;
	/** Namespace chosen by the controller and required to match the profile. */
	readonly namespace: string;
	/** Opaque reference that the server matches by hash after it verifies the worker identity. */
	readonly bootstrapReference: string;
}
