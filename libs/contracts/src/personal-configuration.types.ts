/**
 * Stable discriminants for changes that can be proposed to a personal agent configuration.
 *
 * The string values are part of both the durable `requestedPatch` JSON stored by the control plane
 * and the public tool/API schemas that describe that JSON. Callers must use these enum members
 * instead of repeating the serialized strings so validation, persistence filters, and downstream
 * materializers cannot silently disagree about which patch variants exist.
 */
export enum AgentConfigPatchKinds
{
  /**
   * Requests a new, proposal-bound persona onboarding flow.
   *
   * This patch never carries replacement persona text. The persona authority gathers reviewed
   * interview evidence, produces a new immutable persona revision, and applies the proposal only
   * when that exact revision is approved.
   */
  PersonaRefresh = "persona_refresh",
  /**
   * Requests a registered model alias for future personal-agent runs.
   *
   * The configuration authority resolves the human-visible alias inside the owner's silo, copies
   * the current immutable agent revision with only its model changed, and activates that copy. It
   * does not rewrite the input snapshot of a run that is already in progress.
   */
  ModelAlias = "model_alias",
}
