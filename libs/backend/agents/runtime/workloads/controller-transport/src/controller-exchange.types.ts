/**
 * Defines the fetch boundary used by controller-only HTTP authorities.
 *
 * Production uses the process fetch implementation while tests inject a controlled exchange.
 */
export type ControllerExchangeFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Reads the projected controller token used for one private server request.
 *
 * The exchange calls this for every request so it does not retain a token across Kubernetes rotation.
 */
export type ControllerTokenReader = () => Promise<string>;

/**
 * Configures authenticated controller calls to one private server route family.
 *
 * The fixed in-cluster origin and rotating projected token keep an adapter inside its controller-
 * to-server boundary. Tests may replace network and token reads without widening that boundary.
 */
export interface ControllerExchangeOptions
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
	readonly fetch?: ControllerExchangeFetch;
	/** Optional replacement for the token reader, used by tests. */
	readonly readToken?: ControllerTokenReader;
}

/**
 * Describes one controller-to-server request with its conflict and success handling.
 *
 * A 409 response returns {@link ControllerExchangeRequest.conflict} unchanged, so each caller keeps
 * its own stale-delivery sentinel (`null`, `"conflict"`); a route that never expects a 409 omits it
 * and a 409 then throws like any unexpected status. Any other non-200 status throws with
 * {@link ControllerExchangeRequest.failure} in the message. A 200 body is bounded, decoded, and
 * passed through {@link ControllerExchangeRequest.parse} before the caller may act on it.
 */
export interface ControllerExchangeRequest<TSuccess, TConflict = never>
{
	/** Server route path, already carrying its encoded route identities. */
	readonly path: string;
	/** HTTP method for this route. */
	readonly method: "POST" | "PUT";
	/** JSON request body. */
	readonly body: unknown;
	/** Value returned unchanged when the server answers 409; omit to fail closed on 409. */
	readonly conflict?: TConflict;
	/** Value returned unchanged when the server answers 204; omit to fail closed on 204. */
	readonly noContent?: TSuccess;
	/** Short operation name used in failure messages, e.g. "artifact preprocessing claim". */
	readonly failure: string;
	/** Strict validator for the 200 response body; must throw on any unexpected shape. */
	readonly parse: (value: unknown) => TSuccess;
}

/**
 * One authenticated controller-to-server JSON exchange over the private in-cluster origin.
 *
 * Created once per controller authority by `__CreateControllerExchange`. Every call re-reads the
 * projected token, bounds the response size, and validates the body before returning it.
 */
export interface ControllerExchange
{
	/** Performs one request and maps 409 to the caller's conflict sentinel. */
	exchange<TSuccess, TConflict = never>(request: ControllerExchangeRequest<TSuccess, TConflict>): Promise<TSuccess | TConflict>;
}
