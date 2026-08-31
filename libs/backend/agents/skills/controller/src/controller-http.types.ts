/** Fetch-compatible function injected into the controller's internal HTTP authority. */
export type SkillAuthoringValidationControllerFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Reads the current projected controller token from its rotating file. */
export type SkillAuthoringValidationControllerTokenReader = () => Promise<string>;

/**
 * Supplies authenticated calls from the controller to the same-silo server.
 *
 * The authority validates the server origin before it reads the projected token, so configuration
 * cannot redirect that token to another endpoint.
 */
export interface SkillAuthoringValidationControllerHttpAuthorityOptions
{
	/** Internal origin whose hostname must match the configured Service and namespace. */
	readonly openCraneInternalUrl: string;
	/** Service name used to construct the sole hostname permitted to receive the token. */
	readonly serverServiceName: string;
	/** Service namespace used to construct the sole hostname permitted to receive the token. */
	readonly serverNamespace: string;
	/** Absolute path of the rotating projected controller token. */
	readonly tokenPath: string;
	/** Hard timeout for one internal server request. */
	readonly requestTimeoutMilliseconds: number;
	/** Cancels in-flight requests while the controller shuts down. */
	readonly shutdownSignal?: AbortSignal;
	/** Replaces fetch in tests. */
	readonly fetch?: SkillAuthoringValidationControllerFetch;
	/** Replaces projected-token reading in tests. */
	readonly readToken?: SkillAuthoringValidationControllerTokenReader;
}
