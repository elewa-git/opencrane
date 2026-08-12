/**
 * Types for the AIR.7 off-policy evaluation (OPE) maths.
 *
 * The question OPE answers: if we had been routing with a different model-choice policy, would we
 * have done better? It answers that from calls already logged under the CURRENT policy, so a
 * candidate policy can be scored without ever being put in front of real traffic.
 *
 * These are plain functions over logged samples — no I/O. Producing candidate policies in the
 * first place (RouteLLM-style training, bandits) is a separate job that is not implemented here;
 * see `app-specific.md`.
 */

/**
 * One logged call, with everything needed to score a candidate policy against it.
 *
 * `loggedAction` is the model that actually ran and earned `reward`. `candidateAction` is the model
 * the policy under test would have picked. When the two differ there is no observed reward for the
 * candidate, which is why the other two fields exist: `propensity` (how likely the logging policy
 * was to pick what it picked) and `rewardModelPred` (a model's guess at the candidate's reward).
 * `_ReplayEstimate` uses only the matching samples; `_DoublyRobustEstimate` uses all of them.
 *
 * `propensity` must be greater than zero. A matched sample with a non-positive propensity is not
 * an error — `_DoublyRobustEstimate` skips its correction term rather than dividing by zero.
 */
export interface OpeSample
{
  /** The action (model) the logging policy actually took on this call. */
  loggedAction: string;
  /** The action (model) the candidate policy would take on the same call. */
  candidateAction: string;
  /** The observed reward of the logged action (e.g. judge score minus normalised cost). */
  reward: number;
  /** Probability the logging policy assigned to `loggedAction` (the propensity; must be > 0). */
  propensity: number;
  /** A reward model's predicted reward for `candidateAction` on this call (the DR baseline). */
  rewardModelPred: number;
}

/** Options for the bootstrap CI over an OPE point estimate. */
export interface OpeCiOptions
{
  /** Number of bootstrap resamples (default 1000). */
  bootstrapSamples?: number;
  /** Injectable uniform RNG in [0, 1); defaults to Math.random. */
  rng?: () => number;
}

/**
 * A candidate policy's estimated value, with a bootstrap 95% confidence interval.
 *
 * Read the interval before acting on `value`. All three fields are 0 for empty input, which means
 * "no signal", not "no improvement" — a caller that treats 0 as a real measurement would ship a
 * policy change on no evidence.
 */
export interface OpeEstimate
{
  /** The point value estimate of the candidate policy's expected reward. */
  value: number;
  /** Lower bound of the bootstrap 95% CI. */
  ciLow: number;
  /** Upper bound of the bootstrap 95% CI. */
  ciHigh: number;
}
