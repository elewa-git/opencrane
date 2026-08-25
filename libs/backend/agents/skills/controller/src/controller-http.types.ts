/** Fetch-compatible function injected into a controller-only internal HTTP authority. */
export type SkillAuthoringValidationControllerFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Reads the current projected controller token from its rotating file. */
export type SkillAuthoringValidationControllerTokenReader = () => Promise<string>;

/**
 * Supplies the controller's authenticated calls to the same-silo server API.
 *
 * The adapter checks the configured origin against the Service and namespace before it reads a
 * projected token, so environment configuration cannot redirect that token to another endpoint.
 */
export interface SkillAuthoringValidationControllerHttpAuthorityOptions
{
	/** Sets the internal origin whose hostname must match the configured Service and namespace. */
	readonly openCraneInternalUrl: string;
	/** Names the Service used to construct the sole hostname permitted to receive the token. */
	readonly serverServiceName: string;
	/** Names the Service namespace used to construct the sole hostname permitted to receive the token. */
	readonly serverNamespace: string;
	/** Absolute path of the rotating projected controller token. */
	readonly tokenPath: string;
	/** Hard timeout for one internal server request. */
	readonly requestTimeoutMilliseconds: number;
	/** Optional process signal that cancels in-flight calls during controller shutdown. */
	readonly shutdownSignal?: AbortSignal;
	/** Optional replacement for fetch, used by tests. */
	readonly fetch?: SkillAuthoringValidationControllerFetch;
	/** Optional replacement for the token reader, used by tests. */
	readonly readToken?: SkillAuthoringValidationControllerTokenReader;
}
