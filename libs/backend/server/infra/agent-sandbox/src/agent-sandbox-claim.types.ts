import type { V1ObjectMeta } from "@kubernetes/client-node";

/** Supplies the release-owned values needed to realize one fenced computer generation. */
export interface AgentSandboxClaimCommand
{
	readonly siloId: string;
	readonly computerId: string;
	readonly leaseId: string;
	readonly generation: number;
	readonly namespace: string;
	readonly profileName: string;
	readonly warmPoolName: string;
	readonly expiresAt: string;
	readonly reason: "activation_requested" | "recovery_requested";
}

/** Reports the converged claim identity without treating controller readiness as claim creation. */
export interface AgentSandboxClaimResult
{
	readonly claimId: string;
	readonly outcome: "created" | "existing";
	readonly sandboxId: string | null;
	readonly serviceFQDN: string | null;
}

/** Supplies the exact deterministic claim coordinates that may be released. */
export interface AgentSandboxClaimReleaseCommand
{
	readonly namespace: string;
	readonly claimId: string;
	readonly computerId: string;
	readonly leaseId: string;
	readonly generation: number;
}

/** Supplies the exact deterministic claim coordinates whose shutdown time may move later. */
export interface AgentSandboxClaimRenewCommand extends AgentSandboxClaimReleaseCommand
{
	/** Sets the new ISO shutdown instant that must be later than the current one. */
	readonly expiresAt: string;
}

/**
 * Reports what the controller currently records for one deterministic claim.
 *
 * The lifecycle worker compares these values with canonical KurrentDB lease history to decide
 * whether a realization is still alive, not to grant it any authority.
 */
export interface AgentSandboxClaimStatus
{
	/** Names the deterministic claim that was read. */
	readonly claimId: string;
	/** Identifies the assigned sandbox, or null while the controller is still assigning one. */
	readonly sandboxId: string | null;
	/** Carries the controller-reported Service DNS name after assignment. */
	readonly serviceFQDN: string | null;
	/** Reports the shutdown instant the claim currently carries. */
	readonly shutdownTime: string | null;
}

/** Reads the claim fields owned by the pinned v0.5.3 extensions controller. */
export interface _SandboxClaimResource
{
	/** Identifies the installed Kubernetes group and served version. */
	readonly apiVersion?: string;
	/** Distinguishes a claim from the Sandbox it controls. */
	readonly kind?: string;
	/** Carries the API identity and the admitted lease labels. */
	readonly metadata?: V1ObjectMeta;
	/** Carries the release-constrained claim request. */
	readonly spec?: {
		/** Selects the release-owned pool and its computer template. */
		readonly warmPoolRef?: {
			/** Identifies the pool inside the claim namespace. */
			readonly name?: string;
		};
		/** Bounds the lifetime and deletion behaviour of the claim. */
		readonly lifecycle?: {
			/** Requires foreground deletion when the lease ends. */
			readonly shutdownPolicy?: string;
			/** Holds the controller's shutdown instant. */
			readonly shutdownTime?: string;
			/** Exposes the upstream field so unexpected retention policy is rejected. */
			readonly ttlSecondsAfterFinished?: number;
		};
		/** Copies admitted lease identity to the computer Pod. */
		readonly additionalPodMetadata?: {
			/** Carries the computer, generation and lease identifiers. */
			readonly labels?: Readonly<Record<string, string>>;
			/** Must be absent or empty for an OpenCrane claim. */
			readonly annotations?: Readonly<Record<string, string>>;
		};
		/** Exposes upstream environment overrides so they can be rejected. */
		readonly env?: readonly unknown[];
		/** Exposes upstream storage overrides so they can be rejected. */
		readonly volumeClaimTemplates?: readonly unknown[];
	};
	/** Reports the assigned Sandbox name; the Service address belongs to that Sandbox. */
	readonly status?: {
		/** Describes the assigned Sandbox without granting execution authority. */
		readonly sandbox?: {
			/** Identifies the Sandbox to read in the same namespace. */
			readonly name?: string;
			/** Carries upstream Pod addresses, which this adapter does not use. */
			readonly podIPs?: readonly string[];
		};
	};
}

/** Reads the ownership and Service status fields of the pinned v0.5.3 Sandbox. */
export interface _SandboxResource
{
	/** Identifies the installed Sandbox API group and version. */
	readonly apiVersion?: string;
	/** Identifies the Sandbox resource kind. */
	readonly kind?: string;
	/** Carries the resource identity and its controlling SandboxClaim owner reference. */
	readonly metadata?: V1ObjectMeta;
	/** Reports the controller-created Service before the Pod necessarily becomes ready. */
	readonly status?: {
		/** Identifies the Service created by the Sandbox controller. */
		readonly service?: string;
		/** Carries its fully qualified Domain Name System address. */
		readonly serviceFQDN?: string;
	};
}
