import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { ___DoWithoutTrace } from "@opencrane/backend/observability";

import type { ObotFetch, ObotHttpOptions, ObotRequestMethod, ObotSession, ObotTransportFailureCode } from "./obot-http.types.js";

/** Maximum body accepted from one Obot management exchange. */
const _MAX_RESPONSE_BYTES = 256 * 1024;

/** Smallest accepted per-exchange timeout. */
const _MIN_TIMEOUT_MILLISECONDS = 1_000;

/** Largest accepted per-exchange timeout. */
const _MAX_TIMEOUT_MILLISECONDS = 300_000;

/**
 * Typed failure raised when Obot could not be reached or refused a management exchange.
 *
 * The bounded {@link ObotTransportFailureCode} is the ONLY detail carried out of the transport:
 * remote bodies, credential material, and tool payloads never appear in the message.
 */
export class ObotTransportError extends Error
{
	/** Bounded failure class safe to project into durable custody or key-issuance evidence. */
	readonly code: ObotTransportFailureCode;

	/** Creates a transport failure that names only its bounded class. */
	constructor(code: ObotTransportFailureCode)
	{
		super(`Obot transport failed: ${code}`);
		this.name = "ObotTransportError";
		this.code = code;
	}
}

/**
 * Typed failure raised when Obot answered outside the expected management protocol.
 *
 * The message names only the violated expectation — never a remote body, so an unrecognised
 * response shape cannot smuggle credential or tool content into logs or durable evidence.
 */
export class ObotProtocolError extends Error
{
	/** Creates a protocol violation that names the failed expectation only. */
	constructor(message: string)
	{
		super(message);
		this.name = "ObotProtocolError";
	}
}

/** Validate and normalize the release-local Obot origin. */
function _ObotOrigin(value: string): URL
{
	const parsed = URL.parse(value);
	if (!parsed || parsed.protocol !== "http:" || !parsed.hostname.endsWith(".svc.cluster.local") || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "" || parsed.username !== "" || parsed.password !== "")
	{
		throw new Error("OBOT_GATEWAY_URL must be one release-local Kubernetes Service HTTP origin with no path or credentials");
	}
	return parsed;
}

/** Read one Obot response without allocating beyond the fixed protocol ceiling. */
async function _ReadBoundedText(response: Response): Promise<string>
{
	const declaredLength = response.headers.get("content-length");
	if (declaredLength !== null)
	{
		const parsedLength = Number(declaredLength);
		if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > _MAX_RESPONSE_BYTES)
		{
			await response.body?.cancel();
			throw new ObotTransportError("oversize");
		}
	}
	if (response.body === null) return "";

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	while (true)
	{
		const result = await reader.read();
		if (result.done) return Buffer.concat(chunks, byteLength).toString("utf8");
		byteLength += result.value.byteLength;
		if (byteLength > _MAX_RESPONSE_BYTES)
		{
			await reader.cancel();
			throw new ObotTransportError("oversize");
		}
		chunks.push(result.value);
	}
}

/**
 * Classify a fetch rejection into a bounded transport failure.
 *
 * Typed failures raised while reading a body are rethrown untouched so a protocol violation is not
 * relabelled as a network fault.
 *
 * @param error - Value thrown by fetch or by bounded reading.
 * @returns Never; always throws.
 */
function _ThrowTransportFailure(error: unknown): never
{
	if (error instanceof ObotTransportError || error instanceof ObotProtocolError) throw error;
	const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
	throw new ObotTransportError(isTimeout ? "timeout" : "network");
}

/** Read the mounted Obot service credential without retaining a stale copy in process memory. */
function _CreateServiceTokenReader(tokenFile: string): () => Promise<string>
{
	return async function _readServiceToken(): Promise<string>
	{
		const token = await readFile(tokenFile, "utf8");
		if (token.trim().length === 0) throw new Error("mounted Obot service token is empty");
		return token.trim();
	};
}

/** Parse untrusted Obot JSON into an unknown value, failing as a protocol violation. */
function _ParseJson(text: string): unknown
{
	try
	{
		return JSON.parse(text) as unknown;
	}
	catch
	{
		throw new ObotProtocolError("Obot returned malformed JSON");
	}
}

/** Parse the first complete data frame from an MCP server-sent event response. */
function _ParseEventStream(text: string): unknown
{
	const dataLines: string[] = [];
	for (const rawLine of text.split(/\r?\n/u))
	{
		if (rawLine.length === 0 && dataLines.length > 0) break;
		if (rawLine.startsWith("data:")) dataLines.push(rawLine.slice("data:".length).trimStart());
	}
	if (dataLines.length === 0) throw new ObotProtocolError("Obot MCP event stream carried no data frame");
	return _ParseJson(dataLines.join("\n"));
}

/** Parse an MCP response body according to its validated media type. */
function _ParseMcpBody(text: string, contentType: string): unknown
{
	const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
	if (mediaType === "application/json") return _ParseJson(text);
	if (mediaType === "text/event-stream") return _ParseEventStream(text);
	throw new ObotProtocolError("Obot MCP response used an unsupported content type");
}

/** Validate an Obot MCP session header before it can be replayed into a later request. */
function _McpSessionId(value: string | null): string | null
{
	if (value === null) return null;
	if (value.length === 0 || value.length > 1_024 || /[\u0000-\u001f\u007f]/u.test(value))
	{
		throw new ObotProtocolError("Obot MCP response returned an invalid session id");
	}
	return value;
}

/**
 * Create the authenticated Obot session used by server-owned custody and action adapters.
 *
 * Every exchange presents the freshly read Obot service credential as a bearer token, applies one
 * hard timeout, refuses redirects, and bounds the response read. Every fetch runs with automatic
 * child tracing suppressed so bearer headers cannot become child-span attributes; the caller's
 * explicit operation span remains active. Response bodies are returned as parsed JSON — the calling
 * adapter validates every field it consumes and treats anything unrecognised as a protocol error.
 *
 * @param options - Obot origin, timeout, mounted service token, and test seams.
 * @returns A session issuing bounded, timeout-guarded JSON exchanges.
 */
export function __CreateObotSession(options: ObotHttpOptions): ObotSession
{
	// 1. Validate the origin and timeout before any credential file can be read; a malformed
	// deployment must fail composition rather than authenticate against an unintended host.
	const baseUrl = _ObotOrigin(options.baseUrl);
	if (!Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < _MIN_TIMEOUT_MILLISECONDS || options.requestTimeoutMilliseconds > _MAX_TIMEOUT_MILLISECONDS)
	{
		throw new Error("Obot request timeout must be between 1 and 300 seconds");
	}
	if (options.readServiceToken === undefined && !isAbsolute(options.serviceTokenFile))
	{
		throw new Error("OBOT_SERVICE_TOKEN_PATH must be an absolute mounted file path");
	}

	// 2. Resolve seams once so production and focused tests share the identical exchange path.
	const fetchRequest: ObotFetch = options.fetch ?? fetch;
	const readServiceToken = options.readServiceToken ?? _CreateServiceTokenReader(options.serviceTokenFile);

	// 3. Return the single bounded exchange primitive; adapters own path selection and validation.
	return {
		async request(path: string, method: ObotRequestMethod, body?: unknown): Promise<unknown>
		{
			const headers = new Headers({ accept: "application/json" });
			if (body !== undefined) headers.set("content-type", "application/json");
			headers.set("authorization", `Bearer ${await readServiceToken()}`);
			let response: Response;
			try
			{
				response = await ___DoWithoutTrace(function _fetchSensitiveEndpoint()
				{
					return fetchRequest(new URL(path, baseUrl), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(options.requestTimeoutMilliseconds), redirect: "error" });
				});
			}
			catch (error)
			{
				return _ThrowTransportFailure(error);
			}
			if (!response.ok)
			{
				await response.body?.cancel();
				throw new ObotTransportError(`http_${response.status}`);
			}
			try
			{
				const text = await _ReadBoundedText(response);
				return text.trim().length === 0 ? null : _ParseJson(text);
			}
			catch (error)
			{
				return _ThrowTransportFailure(error);
			}
		},

		async mcpRequest(path: string, body: unknown, sessionId?: string)
		{
			// 1. Present the server-owned service credential and the prior MCP session id only to the
			// release-local Obot endpoint; neither value is returned to the caller or traced.
			const headers = new Headers({ accept: "application/json, text/event-stream", "content-type": "application/json" });
			headers.set("authorization", `Bearer ${await readServiceToken()}`);
			if (sessionId !== undefined)
			{
				const validatedSessionId = _McpSessionId(sessionId);
				if (validatedSessionId === null) throw new ObotProtocolError("Obot MCP request carried no session id");
				headers.set("mcp-session-id", validatedSessionId);
			}

			// 2. Run the exchange through the same bounded transport and suppressed child-trace seam used
			// for custody calls, so credentials and the tool endpoint cannot enter automatic HTTP spans.
			let response: Response;
			try
			{
				response = await ___DoWithoutTrace(function _fetchSensitiveMcpEndpoint()
				{
					return fetchRequest(new URL(path, baseUrl), { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(options.requestTimeoutMilliseconds), redirect: "error" });
				});
			}
			catch (error)
			{
				return _ThrowTransportFailure(error);
			}
			if (!response.ok)
			{
				await response.body?.cancel();
				throw new ObotTransportError(`http_${response.status}`);
			}

			// 3. Parse only the bounded JSON-RPC frame and validated session header. Raw bytes, response
			// headers, and remote error details never cross the session boundary.
			try
			{
				const text = await _ReadBoundedText(response);
				if (text.trim().length === 0) throw new ObotProtocolError("Obot MCP response body was empty");
				return { payload: _ParseMcpBody(text, response.headers.get("content-type") ?? ""), sessionId: _McpSessionId(response.headers.get("mcp-session-id")) };
			}
			catch (error)
			{
				return _ThrowTransportFailure(error);
			}
		},
	};
}
