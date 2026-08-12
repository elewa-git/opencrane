/**
 * Types for `_ResolveSkillModel` — the helper that decides which model one skill actually runs on
 * (Track AIR.2).
 *
 * It is a plain function over rows someone else already loaded: no database calls, no HTTP, and it
 * never talks to LiteLLM. That means it can be read and tested top to bottom without a live
 * platform.
 *
 * The order of precedence is the whole contract, highest first:
 *   1. a model named explicitly on the request — decided before this file is reached, never here;
 *   2. the skill's own pinned model;
 *   3. the skill choosing `auto`;
 *   4. the ClusterTenant scope default;
 *   5. the platform-wide Global default.
 * Auto-routing is never inferred: it applies only because a skill, or a scope default, asked for
 * it. When nothing in the chain names a model, the result is `model: null` and the pod uses
 * whatever default it was configured with.
 */

import type { AutoRoutingConfig, SkillModelMode } from "@opencrane/contracts";

/**
 * One skill's own model posture, read off its `Skill` row: does it pin a model, ask for
 * auto-routing, or say nothing and inherit?
 *
 * The three fields are not independent. `modelMode` decides which of the other two is meaningful,
 * and the resolver ignores the irrelevant one. A `pinned` mode with no `pinnedModel` is not an
 * error — it simply falls through to the scope default, so a half-configured skill still runs.
 *
 * @see {@link SkillModelResolution} for what the resolver produces from this.
 */
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

/** The two defaults a skill can inherit. The ClusterTenant one wins, but only if it actually names a model — an empty ClusterTenant row does not hide a usable Global default. */
export interface ScopeDefaults
{
  /** The owning ClusterTenant's default, when one is configured; null otherwise. */
  clusterTenant: ScopeDefaultModel | null;
  /** The platform-wide Global default, when one is configured; null otherwise. */
  global: ScopeDefaultModel | null;
}

/**
 * Which step of the precedence chain produced the answer. Recorded so an operator asking "why is
 * this skill on that model?" gets a direct answer instead of having to re-derive it.
 *
 * - `skill-pinned` — the skill named the model itself.
 * - `skill-auto` — the skill asked for auto-routing but no scope default named a base model, so
 *   `model` is null while `auto` is still true.
 * - `scope-default-cluster-tenant` — the owning ClusterTenant's default supplied the model.
 * - `scope-default-global` — the platform-wide default supplied it.
 * - `unresolved` — nothing in the chain named a model; the pod falls back to its own default.
 *
 * Note that `skill-auto` and `scope-default-*` can BOTH describe a skill in auto mode: when the
 * skill asked for auto and a scope default did supply the base model, the source is the scope
 * default, not `skill-auto`.
 */
export type SkillModelResolutionSource =
  | "skill-pinned"
  | "skill-auto"
  | "scope-default-cluster-tenant"
  | "scope-default-global"
  | "unresolved";

/**
 * What the resolver decided: which model, whether it is auto-routing, the config to route with,
 * and which step of the chain produced it.
 *
 * The combination a caller must not miss is `auto: true` with `model: null` — the skill asked for
 * auto-routing but no scope default named a base model. That is not a failure; the runtime routes
 * within `autoConfig` from its own default. Treating `model: null` as "unconfigured" would drop
 * the auto-routing request.
 *
 * @see {@link SkillModelResolutionSource} for what each `source` value means.
 */
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
