import type * as k8s from "@kubernetes/client-node";

/** Kubernetes client seam used only to submit projected-token reviews. */
export type ProjectedTokenReviewApi = Pick<k8s.AuthenticationV1Api, "createTokenReview">;

/**
 * The result of verifying a token against ONE ServiceAccount that deployment configuration
 * fixed in advance.
 *
 * Because the namespace and account name were fixed before the check, the values here
 * simply repeat what was expected — the information is that the token matched them at all.
 * Returned by every {@link FixedServiceAccountTokenReviewer}.
 */
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

/**
 * Who a runtime stream belongs to, as Kubernetes confirmed it.
 *
 * Every field is from the TokenReview response, never from the request body. The Pod UID
 * matters most: the stream transport compares it against the Pod UID the runtime claims in
 * its stream-open message and rejects a mismatch, so one Pod's token cannot be used to
 * open a stream on behalf of another.
 */
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

/**
 * The one thing the runtime stream transport may do with a credential: ask whether it is
 * valid and, if so, whose it is.
 *
 * Kept this narrow on purpose — the transport gets an identity or nothing, and never sees
 * the TokenReview response, so it cannot start interpreting Kubernetes results itself.
 *
 * Implemented by: `_CreateWarmRuntimeTokenReviewer` in projected-token-reviewer.ts.
 * Called by: `_RegisterInternalAgentRuntimeStream` in
 * libs/backend/server/infra/agent-runtime-stream, on both of its routes.
 *
 * @see https://kubernetes.io/docs/reference/access-authn-authz/authentication/ — TokenReview
 *      and the audience-bound ServiceAccount tokens being checked.
 */
export interface RuntimeTokenReviewer
{
	/**
	 * Verify one bearer token.
	 *
	 * @param token - The raw token from the `Authorization: Bearer` header.
	 * @returns The verified workload identity, or null for EVERY failure — invalid token,
	 *          wrong audience, wrong namespace, unexpected ServiceAccount name, or no bound
	 *          Pod UID. Callers must treat null as one undifferentiated denial.
	 * @throws When the Kubernetes API call itself fails; that is an outage, not a denial, and
	 *         must not be reported to the caller as an authentication failure.
	 */
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

/**
 * The raw namespace values read from deployment configuration, before checking. The two
 * runtime namespaces are optional here only because configuration may omit them;
 * {@link _ValidateRuntimeIdentityNamespaces} then throws rather than defaulting, which is
 * why the checked type {@link RuntimeIdentityNamespaces} has them required.
 */
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
