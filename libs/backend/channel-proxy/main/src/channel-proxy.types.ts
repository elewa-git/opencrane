/** Configuration shared by command and event forwarding. */
export interface ChannelProxyConfig
{
	/** Exact HTTPS browser origins allowed to use the proxy. */
	allowedOrigins: ReadonlySet<string>;
	/** Internal DNS suffixes to which an authorized route may point. */
	allowedTargetHostSuffixes: readonly string[];
	/** Maximum accepted command body size in bytes. */
	maxCommandBytes: number;
	/** Maximum command response body size in bytes. */
	maxCommandResponseBytes: number;
	/** Maximum duration of a command request in milliseconds. */
	commandTimeoutMs: number;
	/** Maximum time to establish an SSE upstream in milliseconds. */
	streamConnectTimeoutMs: number;
	/** Maximum duration of an SSE relay in milliseconds. */
	streamDurationMs: number;
	/** Maximum silence between SSE chunks in milliseconds. */
	streamIdleTimeoutMs: number;
	/** Maximum bytes in one SSE event before its delimiter. */
	maxEventBytes: number;
}

/** Identity material that only OpenCrane may interpret. */
export interface DelegatedSession
{
	/** Browser session cookie, when cookie authentication is used. */
	cookie?: string;
	/** Browser authorization value, when token authentication is used. */
	authorization?: string;
	/** Same-origin host already bound to the validated Origin. */
	trustedHost: string;
}

/** An operation for which the proxy requests an authorized target. */
export interface TargetResolutionRequest
{
	/** Delegated browser identity inputs. */
	session: DelegatedSession;
	/** Stable target-neutral operation name. */
	action: "command.forward" | "events.read";
	/** Canonical thread selected by the caller for either a command or event read. */
	threadId: string;
	/** Caller-supplied key that makes one retried command delivery addressable without trusting its body. */
	requestIdempotencyKey?: string;
	/** Persisted event cursor selected by the caller. */
	cursor?: string;
}

/** Short-lived route returned by the OpenCrane authority. */
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

/** OpenCrane target resolver port. */
export interface ChannelTargetResolver
{
	/** Resolve one session-bound operation or reject it. */
	resolve(request: TargetResolutionRequest, signal: AbortSignal): Promise<AuthorizedChannelTarget>;
}

/** Minimal rate-limit port for one authenticated subject. */
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
