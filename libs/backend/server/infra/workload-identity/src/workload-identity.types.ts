import type * as k8s from "@kubernetes/client-node";

/** Kubernetes client seam used only to submit projected-token reviews. */
export type ProjectedTokenReviewApi = Pick<k8s.AuthenticationV1Api, "createTokenReview">;

/** Reviewed fixed ServiceAccount identity used by controller and preprocessing transports. */
export interface ReviewedFixedServiceAccountIdentity
{
	/** Full Kubernetes ServiceAccount username returned by TokenReview. */
	readonly username: string;
	/** Namespace fixed by server deployment policy. */
	readonly namespace: string;
	/** ServiceAccount name fixed by server deployment policy. */
	readonly serviceAccountName: string;
	/** Audiences accepted by Kubernetes for the reviewed token. */
	readonly audiences: readonly string[];
}

/** Deployment-fixed channel-proxy identity accepted by the OpenCrane resolver. */
export interface ChannelProxyTokenReviewerConfig
{
	/** Audience Kubernetes must accept for the projected token. */
	readonly audience: string;
	/** Namespace containing the sole admitted channel-proxy ServiceAccount. */
	readonly namespace: string;
	/** Exact channel-proxy ServiceAccount name admitted by the resolver. */
	readonly serviceAccountName: string;
}

/** Reviewed authoring-worker identity whose exact coordinates are checked by durable bootstrap authority. */
export interface ReviewedSkillWorkloadIdentity
{
	/** Namespace parsed from the authenticated Kubernetes subject. */
	readonly namespace: string;
	/** ServiceAccount name parsed from the authenticated Kubernetes subject. */
	readonly serviceAccountName: string;
	/** Kubernetes Pod UID asserted for the bound projected token. */
	readonly podUid: string;
}

/** Verified runtime workload identity associated with one runtime-initiated connection. */
export interface RuntimeWorkloadIdentity
{
	/** Kubernetes ServiceAccount subject returned by TokenReview. */
	readonly subject: string;
	/** Kubernetes namespace parsed from the authenticated subject. */
	readonly namespace: string;
	/** Kubernetes ServiceAccount name parsed from the authenticated subject. */
	readonly serviceAccountName: string;
	/** Kubernetes Pod UID asserted by TokenReview for this projected token. */
	readonly podUid: string;
}

/** Minimal TokenReview seam consumed by the runtime stream transport. */
export interface RuntimeTokenReviewer
{
	/** Verify a projected token and return the authenticated workload identity. */
	__Review(token: string): Promise<RuntimeWorkloadIdentity | null>;
}

/** Deployment-owned namespaces for mutually exclusive personal and managed runtime identities. */
export interface RuntimeTokenReviewerConfig
{
	/** Namespace containing only personal `agent-runtime-*` workload identities. */
	readonly personalRuntimeNamespace: string;
	/** Namespace containing only managed `managed-agent-runtime-*` workload identities. */
	readonly managedRuntimeNamespace: string;
}

/** Validated namespaces that keep the server, personal runtime, and managed runtime identities apart. */
export interface RuntimeIdentityNamespaces extends RuntimeTokenReviewerConfig
{
	/** Namespace containing the trusted OpenCrane server workload. */
	readonly serverNamespace: string;
}

/** Startup namespace input before fail-closed validation proves all runtime planes are configured. */
export interface RuntimeIdentityNamespaceInput
{
	/** Namespace containing the trusted OpenCrane server workload. */
	readonly serverNamespace: string;
	/** Optional personal runtime namespace read from deployment configuration. */
	readonly personalRuntimeNamespace?: string;
	/** Optional managed runtime namespace read from deployment configuration. */
	readonly managedRuntimeNamespace?: string;
}

/** Minimal reviewer seam for one deployment-fixed ServiceAccount. */
export interface FixedServiceAccountTokenReviewer
{
	/** Verify a projected token against the factory-fixed identity coordinates. */
	__Review(token: string): Promise<ReviewedFixedServiceAccountIdentity | null>;
}

/** Deployment-fixed coordinates accepted at the private memory-gateway boundary. */
export interface MemoryGatewayServerIdentityConfig
{
	/** Audience requested by the memory-gateway TokenReview. */
	readonly audience: string;
	/** Namespace containing the trusted OpenCrane server. */
	readonly namespace: string;
	/** Exact OpenCrane server ServiceAccount name. */
	readonly serviceAccountName: string;
}

/** Reviewer seam for an authoring worker selected later by durable bootstrap authority. */
export interface SkillWorkloadTokenReviewer
{
	/** Verify a projected token for the server-selected audience and return its bound Pod identity. */
	__Review(token: string, audience: string): Promise<ReviewedSkillWorkloadIdentity | null>;
}
