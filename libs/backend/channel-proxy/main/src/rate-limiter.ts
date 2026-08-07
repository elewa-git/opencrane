import type { RateLimiterClock, SubjectRateLimiter } from "./channel-proxy.types.js";

/** One fixed-window counter. */
interface RateBucket
{
	/** Start of the active window. */
	startedAt: number;
	/** Requests admitted in the active window. */
	count: number;
}

/** In-memory per-replica abuse bound; OpenCrane remains the authorization authority. */
export class __FixedWindowRateLimiter implements SubjectRateLimiter
{
	/** Maximum admitted requests per window. */
	private readonly limit: number;
	/** Window duration in milliseconds. */
	private readonly windowMs: number;
	/** Injectable clock. */
	private readonly clock: RateLimiterClock;
	/** Active counters by authenticated subject. */
	private readonly buckets = new Map<string, RateBucket>();

	/** Construct a fixed-window subject limiter. */
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

	/** Consume one request from a subject's current window. */
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
