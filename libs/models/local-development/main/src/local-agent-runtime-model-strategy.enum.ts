/** Selects how a Tier 2 development runtime obtains model output after an attempt is admitted. */
export enum LocalAgentRuntimeModelStrategies
{
	/** The runtime sends model requests through the configured LiteLLM endpoint. */
	LiteLlm = "litellm",
	/** The runtime produces deterministic events without accessing a model endpoint. */
	Simulated = "simulated",
}
