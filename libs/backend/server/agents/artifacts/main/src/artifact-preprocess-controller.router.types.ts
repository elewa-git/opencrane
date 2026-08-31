import type { ArtifactPreprocessControllerAuthority } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";

/**
 * Describes the Kubernetes identity returned after the router reviews a controller token.
 *
 * The router checks every field against its configured service account and audience, so request
 * JSON cannot choose the identity that reaches PDF task state.
 */
export interface ArtifactPreprocessControllerIdentity
{
	/** Holds the Kubernetes service-account username returned by TokenReview. */
	readonly username: string;
	/** Holds the namespace returned by TokenReview. */
	readonly namespace: string;
	/** Holds the service-account name returned by TokenReview. */
	readonly serviceAccountName: string;
	/** Holds the audiences accepted by Kubernetes for this token. */
	readonly audiences: readonly string[];
}

/**
 * Reviews a controller's projected bearer token before the router can access PDF task state.
 *
 * A `null` result denies the request; a returned identity must still match the configured
 * namespace, service account, and audience.
 */
export interface ArtifactPreprocessControllerTokenReviewer
{
	/** Reviews the token and returns its Kubernetes identity, or null when it is not valid. */
	__Review(token: string): Promise<ArtifactPreprocessControllerIdentity | null>;
}

/**
 * Records controller authority failures without receiving request bodies or bearer tokens.
 *
 * The router supplies a fixed operation name and the caught error so failure logs do not repeat
 * credentials from an HTTP request.
 */
export interface ArtifactPreprocessControllerRouterLogger
{
	/** Records one operation failure with its safe operation name. */
	error(bindings: { readonly err: unknown; readonly operation: string }, message: string): void;
}

/**
 * Supplies the authentication, deployment, authority, and logging boundaries for the private API.
 *
 * The router keeps no claim state: after it checks the token and request body, it delegates each
 * transition to the task-bound authority.
 */
export interface ArtifactPreprocessControllerRouterDependencies
{
	/** Reviews projected agent-controller tokens. */
	readonly tokenReviewer: ArtifactPreprocessControllerTokenReviewer;
	/** Holds the server namespace which owns the agent-controller service account. */
	readonly namespace: string;
	/** Holds the isolated worker namespace selected by the PDF Job profile. */
	readonly workerNamespace: string;
	/** Persists the server-owned task claim and Job or Pod bindings. */
	readonly authority: ArtifactPreprocessControllerAuthority;
	/** Records unavailable authority operations. */
	readonly logger: ArtifactPreprocessControllerRouterLogger;
}
