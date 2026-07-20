import { SkillModelMode } from "@opencrane/contracts";

import type { ScopeDefaultModel, ScopeDefaults, SkillModelPosture, SkillModelResolution } from "./resolve-skill-model.types.js";

/**
 * Resolve the effective scope default, applying the ClusterTenant-then-Global precedence.
 * Returns the first configured default that actually names a model, so an empty ClusterTenant
 * row does not shadow a usable Global default.
 *
 * @param defaults - The available scope defaults.
 * @returns A tuple of the selected default and its rung label, or null when neither names a model.
 */
function _resolveScopeDefault(defaults: ScopeDefaults): { def: ScopeDefaultModel; rung: "scope-default-cluster-tenant" | "scope-default-global" } | null
{
  // 1. ClusterTenant default wins when it names a concrete model — it is the most specific scope.
  if (defaults.clusterTenant && defaults.clusterTenant.defaultModel)
  {
    return { def: defaults.clusterTenant, rung: "scope-default-cluster-tenant" };
  }

  // 2. Otherwise fall back to the platform-wide Global default when it names a model.
  if (defaults.global && defaults.global.defaultModel)
  {
    return { def: defaults.global, rung: "scope-default-global" };
  }

  // 3. Nothing in either scope names a model.
  return null;
}

/**
 * Resolve a single entitled skill's effective model by the locked precedence chain
 * (Track AIR.2): skill-`pinned` → `pinnedModel`; skill-`auto` → its `autoConfig` over the
 * resolved scope-default model; skill-null → the resolved scope default (ClusterTenant then
 * Global). When nothing resolves, returns `{ model: null }` so the pod falls back to its own
 * configured default.
 *
 * This is a PURE function over already-fetched rows: it performs no I/O and never calls LiteLLM.
 * The explicit per-request model (top of the precedence) is honoured upstream at request time and
 * is intentionally not an input here.
 *
 * @param posture  - The skill's own model posture (mode + pinnedModel + autoConfig).
 * @param defaults - The scope defaults the skill may inherit from.
 * @returns The resolved model, whether it is an auto posture, the effective auto config, and the source rung.
 */
export function _ResolveSkillModel(posture: SkillModelPosture, defaults: ScopeDefaults): SkillModelResolution
{
  // 1. Skill pins a model explicitly — highest skill-level precedence; use it verbatim.
  //    A `pinned` mode with no pinnedModel is treated as unresolved at this rung and falls through.
  if (posture.modelMode === SkillModelMode.Pinned && posture.pinnedModel)
  {
    return { model: posture.pinnedModel, auto: false, autoConfig: null, source: "skill-pinned" };
  }

  // 2. Skill opts into auto-routing — auto applies only because the skill selected it. The base
  //    model is the resolved scope default (auto routes *within* the allowed set, anchored on it);
  //    the effective config is the skill's own autoConfig.
  if (posture.modelMode === SkillModelMode.Auto)
  {
    const scopeDefault = _resolveScopeDefault(defaults);
    return {
      model: scopeDefault ? scopeDefault.def.defaultModel : null,
      auto: true,
      autoConfig: posture.autoConfig,
      source: scopeDefault ? scopeDefault.rung : "skill-auto",
    };
  }

  // 3. Skill declares no posture (null) — inherit the scope default. If that default is itself an
  //    auto config, propagate the auto posture so the runtime treats it as auto routing.
  const scopeDefault = _resolveScopeDefault(defaults);
  if (scopeDefault)
  {
    const isAuto = scopeDefault.def.autoConfig !== null;
    return {
      model: scopeDefault.def.defaultModel,
      auto: isAuto,
      autoConfig: isAuto ? scopeDefault.def.autoConfig : null,
      source: scopeDefault.rung,
    };
  }

  // 4. Nothing in the chain resolves — the pod falls back to its own configured default.
  return { model: null, auto: false, autoConfig: null, source: "unresolved" };
}
