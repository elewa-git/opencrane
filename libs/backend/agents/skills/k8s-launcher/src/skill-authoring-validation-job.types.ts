import type { V1ResourceRequirements } from "@kubernetes/client-node";

/** Defines the deployment-owned policy for every skill-authoring validation Job. */
export interface SkillAuthoringValidationJobProfile
{
	/** Immutable digest-pinned Python worker image. */
	readonly image: string;
	/** Controls reuse of the already-verified immutable image. */
	readonly imagePullPolicy: "Always" | "IfNotPresent" | "Never";
	/** OpenCrane server namespace, which must differ from the Job namespace. */
	readonly serverNamespace: string;
	/** Isolated namespace selected by the deployment. */
	readonly namespace: string;
	/** Fixed zero-RBAC authoring worker identity. */
	readonly serviceAccountName: string;
	/** Audience of the short-lived projected worker token. */
	readonly capabilityTokenAudience: string;
	/** Fixed cluster-local bootstrap base URL. */
	readonly bootstrapUrl: string;
	/** Fixed read-only path of the projected token. */
	readonly capabilityTokenPath: string;
	/** Fixed read-only path of the opaque bootstrap reference. */
	readonly bootstrapReferencePath: string;
	/** Size of the temporary filesystem deleted with the Pod. */
	readonly scratchSize: string;
	/** Maximum wall-clock lifetime of the one-shot Job. */
	readonly activeDeadlineSeconds: number;
	/** Cleanup delay, which must stay zero. */
	readonly ttlSecondsAfterFinished: number;
	/** Bounded CPU and memory requests and limits. */
	readonly resources: V1ResourceRequirements;
}

/** Defines the saved validation coordinates projected into one Job. */
export interface SkillAuthoringValidationJobAssignment
{
	/** Stable controller-owned id for this Job attempt. */
	readonly jobId: string;
	/** Silo that owns the validation. */
	readonly siloId: string;
	/** Namespace that must match the deployment profile. */
	readonly namespace: string;
	/** Opaque one-use bootstrap reference. */
	readonly capabilityReference: string;
}
