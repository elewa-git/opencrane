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
 * Implemented by the fixed-account and Pod-bound reviewers in this package.
 * Called by private workload routes after Kubernetes authenticates a bound Pod token.
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
