/**
 * Selects how a Tier 2 development runtime obtains model output after admission.
 *
 * The controller writes one string value into each child process environment, and the development
 * runtime branches on it before opening the command stream. These values are not persisted or sent
 * through a public API. The runtime rejects an unknown value instead of choosing a model boundary.
 */
export enum LocalAgentRuntimeModelStrategies
{
	/** The runtime sends model requests through the configured LiteLLM endpoint. */
	LiteLlm = "litellm",
	/** The runtime produces deterministic events without accessing a model endpoint. */
	Simulated = "simulated",
}
