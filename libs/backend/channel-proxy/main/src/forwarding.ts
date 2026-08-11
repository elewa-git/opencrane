import { ___DoWithTrace } from "@opencrane/backend/observability";

import type { AuthorizedChannelTarget, ChannelProxyDependencies, DelegatedSession } from "./channel-proxy.types.js";
import { __HasForgedIdentityHeaders, __ValidateOrigin } from "./origin-policy.js";

/** Relay one authenticated SSE event stream from its persisted replay cursor. */
export async function __RelayEvents(request: Request, dependencies: ChannelProxyDependencies): Promise<Response>
{
	const session = _ValidatePublicRequest(request, dependencies);
	if (session instanceof Response)
	{
		return session;
	}
	if (request.method !== "GET")
	{
		return _Problem(405, "method_not_allowed");
	}

	const url = new URL(request.url);
	const conversationId = url.searchParams.get("conversationId") ?? "";
	const queryCursor = url.searchParams.get("cursor");
	const headerCursor = request.headers.get("last-event-id");
	if (!_OpaqueIdentifierAllowed(conversationId) || (queryCursor !== null && !_OpaqueIdentifierAllowed(queryCursor)) || (headerCursor !== null && !_OpaqueIdentifierAllowed(headerCursor)))
	{
		return _Problem(400, "invalid_replay_coordinates");
	}
	if (queryCursor !== null && headerCursor !== null && queryCursor !== headerCursor)
	{
		return _Problem(400, "ambiguous_replay_cursor");
	}
	const cursor = queryCursor ?? headerCursor ?? undefined;

	// 1. Authorize the exact conversation and cursor through OpenCrane before opening a stream.
	let target: AuthorizedChannelTarget;
	try
	{
		target = await ___DoWithTrace("channel.authority.resolve", { action: "events.read", hasCursor: cursor !== undefined }, function _resolveTarget()
		{
			return dependencies.resolver.resolve({ session, action: "events.read", conversationId, cursor }, request.signal);
		});
	}
	catch
	{
		return _Problem(503, "authority_unavailable");
	}
	if (!dependencies.rateLimiter.allow(target.subjectId))
	{
		return _Problem(429, "rate_limited");
	}
	const endpoint = _ValidateTarget(target, dependencies.config.allowedTargetHostSuffixes);
	if (!endpoint)
	{
		return _Problem(502, "invalid_authorized_target");
	}

	// 2. Open the authorized upstream with only invocation and replay context.
	let upstream: Response;
	const connectTimeout = new AbortController();
	const connectTimeoutHandle = setTimeout(function _abortSseConnect() { connectTimeout.abort(new DOMException("event stream connect timeout", "TimeoutError")); }, dependencies.config.streamConnectTimeoutMs);
	try
	{
		const headers = new Headers({ accept: "text/event-stream", authorization: `Bearer ${target.invocationContext}` });
		if (cursor)
		{
			headers.set("last-event-id", cursor);
		}
		upstream = await ___DoWithTrace("channel.events.connect", { hasCursor: cursor !== undefined, targetHost: endpoint.hostname }, function _connectTarget()
		{
			return dependencies.fetch(endpoint, { method: "GET", headers, signal: AbortSignal.any([request.signal, connectTimeout.signal]) });
		});
	}
	catch
	{
		return _Problem(502, "target_unavailable");
	}
	finally
	{
		clearTimeout(connectTimeoutHandle);
	}
	if (!upstream.ok || !upstream.body || !_ContentTypeIsSse(upstream.headers.get("content-type")))
	{
		await upstream.body?.cancel();
		return _Problem(502, "invalid_event_stream");
	}

	// 3. Relay through duration, idle and single-event byte bounds; downstream abort cancels upstream.
	const body = _CreateBoundedSseBody(upstream.body, request.signal, dependencies.config.streamDurationMs, dependencies.config.streamIdleTimeoutMs, dependencies.config.maxEventBytes);
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
}

/** Validate the public event port's same-origin and delegated-session preconditions. */
function _ValidatePublicRequest(request: Request, dependencies: ChannelProxyDependencies): DelegatedSession | Response
{
	if (__HasForgedIdentityHeaders(request.headers))
	{
		return _Problem(400, "forged_identity_input");
	}
	const trustedHost = __ValidateOrigin(request.headers.get("origin"), request.headers.get("host"), dependencies.config.allowedOrigins);
	if (!trustedHost)
	{
		return _Problem(403, "origin_denied");
	}
	const cookie = request.headers.get("cookie") ?? undefined;
	const authorization = request.headers.get("authorization") ?? undefined;
	if (!cookie && !authorization)
	{
		return _Problem(401, "session_required");
	}
	return { cookie, authorization, trustedHost };
}

/** Validate that OpenCrane returned a live, credential-free internal service URL. */
function _ValidateTarget(target: AuthorizedChannelTarget, suffixes: readonly string[]): URL | null
{
	try
	{
		const endpoint = new URL(target.endpoint);
		const expiry = Date.parse(target.expiresAt);
		const hostAllowed = suffixes.some(suffix => suffix.startsWith(".") && endpoint.hostname.endsWith(suffix) && endpoint.hostname.length > suffix.length);
		if (endpoint.protocol !== "http:" || endpoint.username || endpoint.password || endpoint.hash || !hostAllowed || !target.invocationContext || !Number.isFinite(expiry) || expiry <= Date.now())
		{
			return null;
		}
		return endpoint;
	}
	catch
	{
		return null;
	}
}

/** Construct a response stream that never buffers more than one bounded SSE event. */
function _CreateBoundedSseBody(upstream: ReadableStream<Uint8Array>, downstreamSignal: AbortSignal, durationMs: number, idleMs: number, maxEventBytes: number): ReadableStream<Uint8Array>
{
	const reader = upstream.getReader();
	let buffered: Uint8Array<ArrayBufferLike> = new Uint8Array();
	return new ReadableStream<Uint8Array>({
		async start(controller): Promise<void>
		{
			const duration = new AbortController();
			const durationHandle = setTimeout(function _abortDuration() { duration.abort(new DOMException("SSE duration exceeded", "TimeoutError")); }, durationMs);
			const signal = AbortSignal.any([downstreamSignal, duration.signal]);
			try
			{
				while (!signal.aborted)
				{
					const result = await _ReadWithIdleBound(reader, idleMs, signal);
					if (result.done)
					{
						if (buffered.byteLength > 0)
						{
							throw new Error("unterminated SSE event");
						}
						controller.close();
						return;
					}
					if (result.value.byteLength > maxEventBytes)
					{
						throw new Error("SSE chunk exceeds configured byte bound");
					}
					buffered = _AppendBytes(buffered, result.value);
					let boundary = _FindEventBoundary(buffered);
					while (boundary > -1)
					{
						const end = boundary + (buffered[boundary] === 10 ? 2 : 4);
						if (end > maxEventBytes)
						{
							throw new Error("SSE event exceeds configured byte bound");
						}
						controller.enqueue(buffered.slice(0, end));
						buffered = buffered.slice(end);
						boundary = _FindEventBoundary(buffered);
					}
					if (buffered.byteLength > maxEventBytes)
					{
						throw new Error("SSE event exceeds configured byte bound");
					}
				}
				throw signal.reason;
			}
			catch (error)
			{
				await reader.cancel(error).catch(function _ignoreCancelFailure() { return undefined; });
				controller.error(error);
			}
			finally
			{
				clearTimeout(durationHandle);
			}
		},
		async cancel(reason): Promise<void>
		{
			await reader.cancel(reason);
		},
	});
}

/** Race one upstream read against idle and downstream cancellation bounds. */
async function _ReadWithIdleBound(reader: ReadableStreamDefaultReader<Uint8Array>, idleMs: number, signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>>
{
	return new Promise<ReadableStreamReadResult<Uint8Array>>(function _boundedRead(resolve, reject)
	{
		let settled = false;
		const timeout = setTimeout(function _onIdle() { _reject(new DOMException("SSE idle timeout", "TimeoutError")); }, idleMs);
		function _cleanup(): void
		{
			clearTimeout(timeout);
			signal.removeEventListener("abort", _onAbort);
		}
		function _resolve(result: ReadableStreamReadResult<Uint8Array>): void
		{
			if (!settled)
			{
				settled = true;
				_cleanup();
				resolve(result);
			}
		}
		function _reject(error: unknown): void
		{
			if (!settled)
			{
				settled = true;
				_cleanup();
				reject(error);
			}
		}
		function _onAbort(): void { _reject(signal.reason); }
		signal.addEventListener("abort", _onAbort, { once: true });
		void reader.read().then(_resolve, _reject);
	});
}

/** Append two byte arrays without exposing shared mutable storage. */
function _AppendBytes(left: Uint8Array<ArrayBufferLike>, right: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike>
{
	const result = new Uint8Array(left.byteLength + right.byteLength);
	result.set(left);
	result.set(right, left.byteLength);
	return result;
}

/** Find an LF/LF or CRLF/CRLF SSE event boundary. */
function _FindEventBoundary(bytes: Uint8Array<ArrayBufferLike>): number
{
	for (let index = 0; index < bytes.byteLength - 1; index += 1)
	{
		if (bytes[index] === 10 && bytes[index + 1] === 10)
		{
			return index;
		}
		if (index < bytes.byteLength - 3 && bytes[index] === 13 && bytes[index + 1] === 10 && bytes[index + 2] === 13 && bytes[index + 3] === 10)
		{
			return index;
		}
	}
	return -1;
}

/** Accept one compact opaque identifier without control or delimiter characters. */
function _OpaqueIdentifierAllowed(value: string): boolean
{
	return value.length > 0 && value.length <= 200 && /^[A-Za-z0-9._:-]+$/.test(value);
}

/** Identify an SSE response without accepting generic text. */
function _ContentTypeIsSse(value: string | null): boolean
{
	return typeof value === "string" && /^text\/event-stream(?:\s*;|$)/i.test(value);
}

/** Return a small non-sensitive JSON error body. */
function _Problem(status: number, code: string): Response
{
	return Response.json({ error: code }, { status, headers: { "cache-control": "no-store" } });
}
