import type { AwarenessRolloutState, ResolvedAwarenessVersion } from "./rollout.types.js";

/** Default awareness label used when no rollout has been configured. */
export const ___DEFAULT_AWARENESS_CONTRACT_VERSION = "awareness/v1alpha1";

/**
 * Default canary waves, narrow→wide (the locked P4B.0 order). A rollout promotes
 * the target version one wave at a time so blast radius widens gradually.
 */
export const ___DEFAULT_AWARENESS_WAVES: string[] = ["personal", "project", "department", "org"];

/**
 * Resolve the awareness contract version a tenant should run under the rollout.
 *
 * A tenant with no assigned wave is treated as the **last** wave (most
 * conservative — promoted last), so unmanaged tenants only move to the target
 * once the rollout is fully complete. A promoted wave gets the target (or, in
 * shadow mode, still serves stable while flagged); otherwise stable.
 *
 * @param state      - The current rollout state.
 * @param tenantWave - The tenant's assigned wave, or null/undefined.
 * @returns The resolved version + promotion/shadow/wave detail.
 */
export function _ResolveAwarenessVersion(state: AwarenessRolloutState, tenantWave: string | null | undefined): ResolvedAwarenessVersion
{
  // 1. Resolve the effective wave — unassigned tenants ride the final wave so
  //    they are promoted last (safest default for an unmanaged tenant).
  const lastWave = state.waves.length > 0 ? state.waves[state.waves.length - 1] : "org";
  const wave = tenantWave && state.waves.includes(tenantWave) ? tenantWave : lastWave;

  // 2. A promoted wave runs the target; in shadow mode it still serves stable
  //    (the agent computes against target but answers from stable until cutover).
  const promoted = state.promotedWaves.includes(wave);
  if (promoted)
  {
    return { version: state.shadowMode ? state.stableVersion : state.targetVersion, promoted: true, shadow: state.shadowMode, wave };
  }

  // 3. Un-promoted waves stay on the stable version — no fleet downtime.
  return { version: state.stableVersion, promoted: false, shadow: false, wave };
}

/**
 * Promote the next un-promoted wave in canary order (advance the frontier by one).
 * Idempotent once every wave is promoted.
 *
 * @param state - The current rollout state.
 * @returns A new state with the next wave promoted (or unchanged when complete).
 */
export function _PromoteNextWave(state: AwarenessRolloutState): AwarenessRolloutState
{
  const next = state.waves.find(function _unpromoted(w) { return !state.promotedWaves.includes(w); });
  if (!next)
  {
    return state;
  }
  return { ...state, promotedWaves: [...state.promotedWaves, next] };
}

/**
 * Promote every wave up to and including `wave` (in canary order).
 *
 * @param state - The current rollout state.
 * @param wave  - The wave to promote up to.
 * @returns A new state with all waves through `wave` promoted.
 * @throws When `wave` is not a defined wave.
 */
export function _PromoteToWave(state: AwarenessRolloutState, wave: string): AwarenessRolloutState
{
  const index = state.waves.indexOf(wave);
  if (index < 0)
  {
    throw new Error(`unknown wave '${wave}'; defined waves: ${state.waves.join(", ")}`);
  }
  const promotedWaves = state.waves.slice(0, index + 1);
  return { ...state, promotedWaves };
}

/**
 * One-step rollback: clear the promotion frontier so every wave returns to the
 * stable version at once. The target/waves definition is retained so the rollout
 * can be re-promoted without redefining it.
 *
 * @param state - The current rollout state.
 * @returns A new state with no promoted waves.
 */
export function _Rollback(state: AwarenessRolloutState): AwarenessRolloutState
{
  return { ...state, promotedWaves: [] };
}

/**
 * The next wave that a promote would advance to, or null when fully promoted.
 * @param state - The current rollout state.
 */
export function _NextWave(state: AwarenessRolloutState): string | null
{
  return state.waves.find(function _unpromoted(w) { return !state.promotedWaves.includes(w); }) ?? null;
}

/**
 * Validate and normalize a rollout definition, throwing on a malformed one.
 *
 * @param state - Candidate rollout state (e.g. from a PUT request).
 * @returns The normalized state (promotedWaves filtered to defined, ordered waves).
 * @throws When versions are blank, waves are empty, or waves contain duplicates.
 */
export function _NormalizeRollout(state: AwarenessRolloutState): AwarenessRolloutState
{
  // 1. Versions must be present — the resolver always returns one of them.
  if (!state.targetVersion.trim() || !state.stableVersion.trim())
  {
    throw new Error("targetVersion and stableVersion are required");
  }

  // 2. Waves must be a non-empty, duplicate-free ordered list.
  if (state.waves.length === 0)
  {
    throw new Error("at least one wave is required");
  }
  if (new Set(state.waves).size !== state.waves.length)
  {
    throw new Error("waves must be unique");
  }

  // 3. Keep only promoted waves that are actually defined, preserving canary order.
  const promotedWaves = state.waves.filter(function _isPromoted(w) { return state.promotedWaves.includes(w); });
  return { ...state, promotedWaves };
}
