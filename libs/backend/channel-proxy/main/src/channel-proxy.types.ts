/** Limits and allowlists for the event proxy. Every value is a hard bound: nothing here is a hint, and a missing or oversized value must fail the request rather than be defaulted at use time. */
export interface ChannelProxyConfig
{
	/** Exact HTTPS browser origins allowed to use the proxy. */
	allowedOrigins: ReadonlySet<string>;
	/** Internal DNS suffixes to which an authorized route may point. */
	allowedTargetHostSuffixes: readonly string[];
	/** Maximum time to establish an SSE upstream in milliseconds. */
	streamConnectTimeoutMs: number;
	/** Maximum duration of an SSE relay in milliseconds. */
	streamDurationMs: number;
	/** Maximum silence between SSE chunks in milliseconds. */
	streamIdleTimeoutMs: number;
	/** Maximum bytes in one SSE event before its delimiter. */
	maxEventBytes: number;
}

/** The browser's own credentials, passed through untouched. The proxy never parses or validates them — only OpenCrane can — so it must not branch on their contents. */
export interface DelegatedSession
{
	/** Browser session cookie, when cookie authentication is used. */
	cookie?: string;
	/** Browser authorization value, when token authentication is used. */
	authorization?: string;
	/** Same-origin host already bound to the validated Origin. */
	trustedHost: string;
}

/** What the proxy asks OpenCrane to authorize: the browser's session, the action, the conversation, and the cursor to resume from. */
export interface TargetResolutionRequest
{
	/** Delegated browser identity inputs. */
	session: DelegatedSession;
	/** Stable event-read operation name. */
	action: "events.read";
	/** Canonical conversation selected by the caller. */
	conversationId: string;
	/** Persisted event cursor selected by the caller. */
	cursor?: string;
}

/** OpenCrane's answer: where to read the stream, the invocation context to present, and when both stop being valid. Re-authorize rather than caching past `expiresAt`. */
export interface AuthorizedChannelTarget
{
	/** Canonical silo subject used only as a rate-limit key. */
	subjectId: string;
	/** Exact authorized upstream endpoint for this operation. */
	endpoint: string;
	/** Short-lived invocation context understood by the target PEP. */
	invocationContext: string;
	/** Invocation-context expiry in RFC3339 form. */
	expiresAt: string;
}

/** The way the proxy reaches OpenCrane for authorization. Implemented by {@link __OpenCraneTargetResolver}; a test double may replace it, but nothing may bypass it. */
export interface ChannelTargetResolver
{
	/** Resolve one session-bound operation or reject it. */
	resolve(request: TargetResolutionRequest, signal: AbortSignal): Promise<AuthorizedChannelTarget>;
}

/** The way the proxy counts requests per subject. Implemented by {@link __FixedWindowRateLimiter}. `allow` consumes budget, so call it once per request. */
export interface SubjectRateLimiter
{
	/** Consume one request from the subject's current window. */
	allow(subjectId: string): boolean;
}

/** Dependencies for the target-neutral channel proxy. */
export interface ChannelProxyDependencies
{
	/** Validated proxy limits and allowlists. */
	config: ChannelProxyConfig;
	/** OpenCrane authority client. */
	resolver: ChannelTargetResolver;
	/** Per-subject abuse bound. */
	rateLimiter: SubjectRateLimiter;
	/** Injectable HTTP transport. */
	fetch: typeof fetch;
}

/** Options for constructing the OpenCrane resolver client. */
export interface OpenCraneResolverOptions
{
	/** Internal OpenCrane base URL. */
	baseUrl: string;
	/** Path of the projected audience-bound ServiceAccount token. */
	workloadTokenPath: string;
	/** Maximum resolver latency before failure. */
	timeoutMs: number;
	/** Injectable file reader. */
	readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
	/** Injectable HTTP transport. */
	fetch: typeof fetch;
}

/** Clock dependency used by the fixed-window limiter. */
export interface RateLimiterClock
{
	/** Return current wall-clock milliseconds. */
	now(): number;
}
