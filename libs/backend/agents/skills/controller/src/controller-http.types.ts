/** Fetch-compatible function injected into a controller-only internal HTTP authority. */
export type SkillAuthoringValidationControllerFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Reads the current projected controller token from its rotating file. */
export type SkillAuthoringValidationControllerTokenReader = () => Promise<string>;

/** Settings for the controller's authenticated server API calls. */
export interface SkillAuthoringValidationControllerHttpAuthorityOptions
{
	/** Internal OpenCrane origin with no path, query, or credentials. */
	readonly openCraneInternalUrl: string;
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
