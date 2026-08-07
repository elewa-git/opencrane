import type { CanonicalJsonSha256Digest } from "@opencrane/util";

import type { AuthorizationResourceLocator } from "./resource-locator.types.js";

export type { CanonicalJsonSha256Digest } from "@opencrane/util";

/** Immutable reference to a published capability catalog revision. */
export interface CapabilityCatalogReference
{
	/** Stable catalog identifier. */
	catalogId: string;
	/** Positive, monotonically increasing catalog revision. */
	revision: number;
	/** Digest binding the reference to the exact catalog payload. */
	digest: CanonicalJsonSha256Digest;
}

/** Reference to one capability in an immutable catalog revision. */
export interface CapabilityReference
{
	/** Immutable catalog revision that defines the capability. */
	catalog: CapabilityCatalogReference;
	/** Stable capability identifier inside the referenced catalog. */
	capabilityId: string;
}

/** Exact authority conveyed by a proof-of-possession-bound action capability. */
export interface ActionCapability
{
	/** Globally unique capability-instance identifier used for replay handling. */
	readonly jti: string;
	/** Exact audience accepted by the policy-enforcement point. */
	readonly audience: string;
	/** Silo in which the capability is valid. */
	readonly siloId: string;
	/** Subject allowed to exercise the capability. */
	readonly subjectId: string;
	/** Exact projected Kubernetes service account of the exercising workload. */
	readonly serviceAccountName: string;
	/** Exact Kubernetes namespace containing the exercising workload. */
	readonly namespace: string;
	/** Controller-managed Kubernetes workload kind exercising the capability. */
	readonly workloadKind: "job" | "deployment";
	/** Immutable Kubernetes Job or Deployment UID assigned by the controller. */
	readonly workloadUid: string;
	/** Immutable Kubernetes Pod UID registered for this run attempt. */
	readonly podUid: string;
	/** Stable AgentService executed by the workload. */
	readonly agentServiceId: string;
	/** Immutable AgentRevision executed by the workload. */
	readonly agentRevisionId: string;
	/** Logical AgentRun to which the capability belongs. */
	readonly runId: string;
	/** Positive attempt number within the single logical AgentRun. */
	readonly attempt: number;
	/** Immutable catalog capability authorizing the action. */
	readonly capability: CapabilityReference;
	/** Exact resource to which the action may be applied. */
	readonly resource: AuthorizationResourceLocator;
	/** Exact action name from the referenced capability definition. */
	readonly action: string;
	/** SHA-256 digest of the RFC 8785 canonical action arguments. */
	readonly argumentsDigest: CanonicalJsonSha256Digest;
	/** RFC 7638 SHA-256 thumbprint of the ES256 public proof key. */
	readonly proofKeyThumbprint: string;
	/** Digest binding the exact effective policy and grant set used for issuance. */
	readonly effectiveAuthorizationDigest: CanonicalJsonSha256Digest;
	/** NumericDate at which the capability becomes valid. */
	readonly notBefore: number;
	/** NumericDate after which the capability must be rejected. */
	readonly expiresAt: number;
}
