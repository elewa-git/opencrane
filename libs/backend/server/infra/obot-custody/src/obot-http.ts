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

/**
 * Create the authenticated Obot management session used by custody and attempt-key adapters.
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
	};
}
