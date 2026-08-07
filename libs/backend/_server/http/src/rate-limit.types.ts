/** Tuning for the shared HTTP rate limiter. */
export interface RateLimitOptions
{
  /** Sliding window length in milliseconds (default 60,000 = one minute). */
  windowMs?: number;

  /** Maximum requests per window per client IP (default 1,000). */
  max?: number;
}
