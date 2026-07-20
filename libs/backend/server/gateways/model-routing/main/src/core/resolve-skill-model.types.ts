/**
 * Types for the pure per-skill model resolution helper (Track AIR.2).
 *
 * The resolver is a pure function over already-fetched DB rows — it performs no I/O and never
 * calls LiteLLM. It encodes the locked precedence invariant: an explicit request model (handled
 * upstream, never here) > skill-pinned model > skill-`auto` > scope default (ClusterTenant then
 * Global). "auto" applies ONLY when a skill (or scope default) selects it.
 */

import type { AutoRoutingConfig, SkillModelMode } from "@opencrane/contracts";

/** The model-posture inputs of a single entitled skill, as projected from a `Skill` row. */
export interface SkillModelPosture
{
  /** `pinned` (use `pinnedModel`), `auto` (route within `autoConfig`), or null (inherit the scope default). */
  modelMode: SkillModelMode | null;
  /** The pinned model's `publicModelName`; meaningful only when `modelMode` is `pinned`. */
  pinnedModel: string | null;
  /** The skill's auto-routing config; meaningful only when `modelMode` is `auto`. */
  autoConfig: AutoRoutingConfig | null;
}

/** A scope-level default model + auto-config, as projected from a `ModelRoutingDefault` row. */
export interface ScopeDefaultModel
{
  /** Default model `publicModelName` at this scope; null when unset. */
  defaultModel: string | null;
  /** Default auto-routing config at this scope; null when unset. */
  autoConfig: AutoRoutingConfig | null;
}

/** The scope defaults a skill may inherit from, in precedence order (ClusterTenant beats Global). */
export interface ScopeDefaults
{
  /** The owning ClusterTenant's default, when one is configured; null otherwise. */
  clusterTenant: ScopeDefaultModel | null;
  /** The platform-wide Global default, when one is configured; null otherwise. */
  global: ScopeDefaultModel | null;
}

/** How a resolved model was selected — for observability/auditing of the precedence decision. */
export type SkillModelResolutionSource =
  | "skill-pinned"
  | "skill-auto"
  | "scope-default-cluster-tenant"
  | "scope-default-global"
  | "unresolved";

/** The outcome of resolving one skill's effective model. */
export interface SkillModelResolution
{
  /** The resolved `publicModelName`, or null when nothing in the chain resolves (pod falls back to its own default). */
  model: string | null;
  /** Whether the resolved selection is an auto-routing posture (vs a single pinned/default model). */
  auto: boolean;
  /** The effective auto-routing config when `auto` is true; null otherwise. */
  autoConfig: AutoRoutingConfig | null;
  /** Which rung of the precedence chain produced the result. */
  source: SkillModelResolutionSource;
}
