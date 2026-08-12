import type { RateLimiterClock, SubjectRateLimiter } from "./channel-proxy.types.js";

/** One fixed-window counter. */
interface RateBucket
{
	/** Start of the active window. */
	startedAt: number;
	/** Requests admitted in the active window. */
	count: number;
}

/**
 * A fixed-window rate limiter, counted in memory per replica.
 *
 * It exists only to blunt abuse, not to authorize: OpenCrane makes every access decision. Because
 * each replica counts separately, the effective limit across N replicas is roughly N times
 * `limit` — so do not rely on it as a hard quota.
 *
 * Called by: `apps/channel-proxy/src/server.ts`.
 * @implements SubjectRateLimiter
 */
export class __FixedWindowRateLimiter implements SubjectRateLimiter
{
	/** Maximum requests allowed per window. */
	private readonly limit: number;
	/** Window duration in milliseconds. */
	private readonly windowMs: number;
	/** Injectable clock. */
	private readonly clock: RateLimiterClock;
	/** Active counters by authenticated subject. */
	private readonly buckets = new Map<string, RateBucket>();

	/**
	 * Construct a limiter.
	 * @param limit - Maximum requests per window; must be a positive integer.
	 * @param windowMs - Window length in milliseconds; must be a positive integer.
	 * @param clock - Time source, injectable for tests; defaults to `Date.now`.
	 * @throws Error when `limit` or `windowMs` is not a positive integer.
	 */
	constructor(limit: number, windowMs: number, clock: RateLimiterClock = { now: Date.now })
	{
		if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1)
		{
			throw new Error("rate limit and window must be positive integers");
		}
		this.limit = limit;
		this.windowMs = windowMs;
		this.clock = clock;
	}

	/**
	 * Count one request against a subject's current window.
	 *
	 * Calling this consumes budget, so call it once per request. A window starts on the subject's
	 * first request rather than on a shared clock boundary.
	 * @param subjectId - Authenticated subject to count against.
	 * @returns True when the request is within the limit; false when the caller must reject it.
	 */
	allow(subjectId: string): boolean
	{
		const now = this.clock.now();
		const bucket = this.buckets.get(subjectId);
		if (!bucket || now - bucket.startedAt >= this.windowMs)
		{
			this.buckets.set(subjectId, { startedAt: now, count: 1 });
			return true;
		}
		if (bucket.count >= this.limit)
		{
			return false;
		}
		bucket.count += 1;
		return true;
	}
}
