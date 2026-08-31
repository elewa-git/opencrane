/**
 * Defines the fetch boundary used by the controller-only artifact preprocessing authority.
 *
 * Production uses the process fetch implementation while tests inject a controlled exchange.
 */
export type ArtifactPreprocessControllerFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Reads the projected controller token used for one private server request.
 *
 * The authority calls this for every request so it does not retain a token across Kubernetes rotation.
 */
export type ArtifactPreprocessControllerTokenReader = () => Promise<string>;

/**
 * Configures authenticated controller calls to the private artifact preprocessing server routes.
 *
 * The fixed in-cluster origin and rotating projected token keep this adapter inside its controller-
 * to-server boundary. Tests may replace network and token reads without widening that boundary.
 */
export interface ArtifactPreprocessControllerHttpAuthorityOptions
{
	/** Internal OpenCrane origin with no path, query, or credentials. */
	readonly openCraneInternalUrl: string;
	/** Exact Kubernetes Service name that owns the controller-only API. */
	readonly serverServiceName: string;
	/** Exact Kubernetes namespace that owns the controller-only API. */
	readonly serverNamespace: string;
	/** Absolute path of the rotating projected controller token. */
	readonly tokenPath: string;
	/** Hard timeout for one internal server request. */
	readonly requestTimeoutMilliseconds: number;
	/** Optional process signal that cancels in-flight calls during controller shutdown. */
	readonly shutdownSignal?: AbortSignal;
	/** Optional replacement for fetch, used by tests. */
	readonly fetch?: ArtifactPreprocessControllerFetch;
	/** Optional replacement for the token reader, used by tests. */
	readonly readToken?: ArtifactPreprocessControllerTokenReader;
}
