/**
 * Stable discriminants persisted with every personal configuration proposal.
 *
 * These values are shared by validation, storage filters, and public schemas. Their serialized
 * strings are durable API and JSON values, so a member rename must preserve the assigned value.
 */
export enum AgentConfigPatchKinds
{
	/** Starts reviewed persona onboarding; it never carries replacement persona text. */
	PersonaRefresh = "persona_refresh",
	/** Selects a registered model alias for a future immutable agent revision. */
	ModelAlias = "model_alias",
}
