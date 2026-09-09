/**
 * Stable discriminants persisted with every personal configuration proposal.
 *
 * These values are shared by validation, storage filters, and public schemas. Their serialized
 * strings are durable API and JSON values, so a member rename must preserve the assigned value.
 */
export enum AgentConfigPatchKinds
{
	/** Asks to re-run persona onboarding. The proposal carries no persona text — the new persona comes from the reviewed onboarding flow, so this cannot be used to inject one. */
	PersonaRefresh = "persona_refresh",
	/** Selects a registered model alias for a future immutable agent revision. */
	ModelAlias = "model_alias",
}
