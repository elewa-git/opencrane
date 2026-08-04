import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___ParseAndValidateJson } from "@opencrane/util";

import type { AuthorizedChannelTarget, ChannelProxyDependencies, DelegatedSession } from "./channel-proxy.types.js";
import { __HasForgedIdentityHeaders, __ValidateOrigin } from "./origin-policy.js";

/** Headers that the target protocol allows back to an HTTP command caller. */
const _COMMAND_RESPONSE_HEADERS = ["content-type", "etag", "location", "retry-after"];

/** Forward one authenticated HTTP command to the exact route authorized by OpenCrane. */
export async function __ForwardCommand(request: Request, dependencies: ChannelProxyDependencies): Promise<Response>
{
	const session = _ValidatePublicRequest(request, dependencies);
	if (session instanceof Response)
	{
		return session;
	}
	if (request.method !== "POST")
	{
		return _Problem(405, "method_not_allowed");
	}
	if (!_ContentTypeIsJson(request.headers.get("content-type")))
	{
		return _Problem(415, "json_required");
	}

	// 1. Bound public input before asking the authority or contacting a runtime.
	const declaredLength = Number(request.headers.get("content-length") ?? "0");
	if (Number.isFinite(declaredLength) && declaredLength > dependencies.config.maxCommandBytes)
	{
		return _Problem(413, "command_too_large");
	}
	const body = new Uint8Array(await request.arrayBuffer());
	if (body.byteLength > dependencies.config.maxCommandBytes)
	{
		return _Problem(413, "command_too_large");
	}
	const command = _CommandCoordinates(body, request.headers.get("idempotency-key"));
	if (command === null)
	{
		return _Problem(400, "invalid_command");
	}

	// 2. Delegate identity, membership, resource and action decisions to OpenCrane.
	let target: AuthorizedChannelTarget;
	try
	{
		target = await ___DoWithTrace("channel.authority.resolve", { action: "command.forward" }, function _resolveTarget()
		{
			return dependencies.resolver.resolve({ session, action: "command.forward", threadId: command.threadId, requestIdempotencyKey: command.requestIdempotencyKey }, request.signal);
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

	// 3. Forward only the bounded payload and short-lived context to the exact internal target.
	const endpoint = _ValidateTarget(target, dependencies.config.allowedTargetHostSuffixes);
	if (!endpoint)
	{
		return _Problem(502, "invalid_authorized_target");
	}
	const timeout = new AbortController();
	let timedOut = false;
	const timeoutHandle = setTimeout(function _abortTimedOutCommand()
	{
		timedOut = true;
		timeout.abort(new DOMException("command target timeout", "TimeoutError"));
	}, dependencies.config.commandTimeoutMs);
	try
	{
		const signal = AbortSignal.any([request.signal, timeout.signal]);
		const upstream = await ___DoWithTrace("channel.command.forward", { bodyBytes: body.byteLength, targetHost: endpoint.hostname }, function _forwardTarget()
		{
			return dependencies.fetch(endpoint, {
				method: "POST",
				headers: { "content-type": request.headers.get("content-type") ?? "application/json", authorization: `Bearer ${target.invocationContext}` },
				body,
				signal,
			});
		});
		const responseBody = await _ReadBoundedBody(upstream, dependencies.config.maxCommandResponseBytes);
		return new Response(responseBody, { status: upstream.status, headers: _PickHeaders(upstream.headers, _COMMAND_RESPONSE_HEADERS) });
	}
	catch
	{
		return _Problem(timedOut ? 504 : 502, "target_unavailable");
	}
	finally
	{
		clearTimeout(timeoutHandle);
	}
}

/** Parses only the command coordinates required before the proxy asks OpenCrane to authorize a route. */
function _CommandCoordinates(body: Uint8Array, requestIdempotencyKey: string | null): { readonly threadId: string; readonly requestIdempotencyKey: string } | null
{
	try
	{
		return ___ParseAndValidateJson(new TextDecoder().decode(body), "channel command body", _CommandCoordinatesFromUnknown, requestIdempotencyKey);
	}
	catch
	{
		return null;
	}
}

/** Validate the command coordinates required before asking OpenCrane to authorize a route. */
function _CommandCoordinatesFromUnknown(value: unknown, requestIdempotencyKey: string | null): { readonly threadId: string; readonly requestIdempotencyKey: string } | null
{
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (typeof record.threadId !== "string" || !_OpaqueIdentifierAllowed(record.threadId) || !requestIdempotencyKey || !_OpaqueIdentifierAllowed(requestIdempotencyKey)) return null;
	return { threadId: record.threadId, requestIdempotencyKey };
}

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
	const threadId = url.searchParams.get("threadId") ?? "";
	const queryCursor = url.searchParams.get("cursor");
	const headerCursor = request.headers.get("last-event-id");
	if (!_OpaqueIdentifierAllowed(threadId) || (queryCursor !== null && !_OpaqueIdentifierAllowed(queryCursor)) || (headerCursor !== null && !_OpaqueIdentifierAllowed(headerCursor)))
	{
		return _Problem(400, "invalid_replay_coordinates");
	}
	if (queryCursor !== null && headerCursor !== null && queryCursor !== headerCursor)
	{
		return _Problem(400, "ambiguous_replay_cursor");
	}
	const cursor = queryCursor ?? headerCursor ?? undefined;

	// 1. Authorize the exact thread and cursor through OpenCrane before opening a stream.
	let target: AuthorizedChannelTarget;
	try
	{
		target = await ___DoWithTrace("channel.authority.resolve", { action: "events.read", hasCursor: cursor !== undefined }, function _resolveTarget()
		{
			return dependencies.resolver.resolve({ session, action: "events.read", threadId, cursor }, request.signal);
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

/** Validate same-origin and delegated-session preconditions shared by both public ports. */
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

/** Read an HTTP command response without allowing an upstream to exhaust proxy memory. */
async function _ReadBoundedBody(response: Response, maxBytes: number): Promise<ArrayBuffer | null>
{
	const declaredLength = Number(response.headers.get("content-length") ?? "0");
	if (Number.isFinite(declaredLength) && declaredLength > maxBytes)
	{
		await response.body?.cancel();
		throw new Error("command response exceeds configured byte bound");
	}
	if (!response.body)
	{
		return null;
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true)
	{
		const result = await reader.read();
		if (result.done)
		{
			return _AppendChunks(chunks, total).buffer;
		}
		total += result.value.byteLength;
		if (total > maxBytes)
		{
			await reader.cancel();
			throw new Error("command response exceeds configured byte bound");
		}
		chunks.push(result.value);
	}
}

/** Join bounded response chunks into a fresh ArrayBuffer-backed byte array. */
function _AppendChunks(chunks: readonly Uint8Array[], total: number): Uint8Array<ArrayBuffer>
{
	const result = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks)
	{
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
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

/** Identify a JSON media type, including structured suffix forms. */
function _ContentTypeIsJson(value: string | null): boolean
{
	return typeof value === "string" && /^(application\/json|application\/[A-Za-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(value);
}

/** Identify an SSE response without accepting generic text. */
function _ContentTypeIsSse(value: string | null): boolean
{
	return typeof value === "string" && /^text\/event-stream(?:\s*;|$)/i.test(value);
}

/** Copy only explicitly protocol-owned upstream response headers. */
function _PickHeaders(source: Headers, names: readonly string[]): Headers
{
	const result = new Headers();
	for (const name of names)
	{
		const value = source.get(name);
		if (value !== null)
		{
			result.set(name, value);
		}
	}
	return result;
}

/** Return a small non-sensitive JSON error body. */
function _Problem(status: number, code: string): Response
{
	return Response.json({ error: code }, { status, headers: { "cache-control": "no-store" } });
}
