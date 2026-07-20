/**
 * Route-local types for the model-routing-defaults API (Track AIR.4). The wire shapes themselves
 * (`ModelRoutingDefault`, `ModelRoutingDefaultWrite`, `AutoRoutingConfig`) live in
 * `@opencrane/contracts`; this file only carries internal validation helpers.
 */

/** A `{ error, code }` validation-failure envelope, matching the platform's error convention. */
export interface ValidationFailure
{
  /** Human-readable failure reason. */
  error: string;
  /** Stable machine-readable code. */
  code: string;
}
