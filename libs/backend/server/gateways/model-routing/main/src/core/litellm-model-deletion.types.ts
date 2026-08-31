/**
 * Non-secret routing coordinates that distinguish one LiteLLM deployment from another.
 *
 * OpenCrane compares every field before deleting a deployment. A shared public name is not enough:
 * LiteLLM can load-balance several deployments under that name, including deployments created
 * outside OpenCrane. These coordinates are saved with a provider command so retries cannot widen
 * the set that command was allowed to remove.
 */
export interface LiteLlmModelDeploymentCoordinates
{
	/** Public model name that LiteLLM exposes to callers. */
	readonly publicModelName: string;
	/** Upstream provider model stored in `litellm_params.model`. */
	readonly upstreamModel: string;
	/** Upstream base URL, or null when the provider default applies. */
	readonly apiBase: string | null;
	/** Non-secret `os.environ/<name>` reference, or null for credential-store deployments. */
	readonly apiKeyReference: string | null;
	/** LiteLLM credential-store name, or null for an environment-backed deployment. */
	readonly litellmCredentialName: string | null;
	/** LiteLLM request mode; OpenCrane currently admits chat and embedding deployments. */
	readonly mode: "chat" | "embedding";
}

/**
 * A deployment that a committed provider command may remove from LiteLLM.
 *
 * The identifier selects the row sent to `POST /model/delete`; the inherited coordinates prove
 * that the live row is still the deployment the command admitted. Both are required because an id
 * alone says nothing about the provider key or model currently behind it.
 */
export interface LiteLlmModelDeploymentTarget extends LiteLlmModelDeploymentCoordinates
{
	/** Exact LiteLLM deployment identifier sent to the delete endpoint. */
	readonly deploymentId: string;
}
