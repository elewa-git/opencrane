/** Fetch-compatible function used by the controller's internal server authority. */
export type AgentRunWorkflowControllerFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Reads the rotating projected controller token before every server call. */
export type AgentRunWorkflowControllerTokenReader = () => Promise<string>;

/** Supplies the controller's authenticated same-silo API connection. */
export interface AgentRunWorkflowControllerHttpAuthorityOptions
{
	/** Names the internal OpenCrane HTTP origin the controller may call. */
	readonly openCraneInternalUrl: string;
	/** Names the OpenCrane Service that must own the internal origin. */
	readonly serverServiceName: string;
	/** Names the namespace that contains that OpenCrane Service. */
	readonly serverNamespace: string;
	/** Names the absolute projected-token path Kubernetes rotates in place. */
	readonly tokenPath: string;
	/** Limits one internal controller request. */
	readonly requestTimeoutMilliseconds: number;
	/** Cancels in-flight requests when the controller is draining. */
	readonly shutdownSignal?: AbortSignal;
	/** Replaces fetch in tests. */
	readonly fetch?: AgentRunWorkflowControllerFetch;
	/** Replaces projected-token reading in tests. */
	readonly readToken?: AgentRunWorkflowControllerTokenReader;
}
