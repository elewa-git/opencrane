import { readFile } from "node:fs/promises";

import { ___DoWithoutTrace } from "@opencrane/observability";

import { MemoryGatewayProtocolError } from "./personal-memory-record.js";
import type { CogneeFetch, CogneeMemoryGatewayHttpOptions, CogneeSession, MemoryGatewayTransportFailureCode } from "./http-cognee-memory-gateway-client.types.js";

/** Maximum body accepted from one Cognee exchange. */
const _MAX_RESPONSE_BYTES = 256 * 1024;

/**
 * Typed failure raised when Cognee could not be reached or answered outside the protocol.
 *
 * The bounded {@link MemoryGatewayTransportFailureCode} is the ONLY detail carried out of the
 * transport: remote bodies, fact content, and credentials never appear in the message.
 */
export class MemoryGatewayTransportError extends Error
{
	/** Bounded failure class safe to project into a durable invocation failure code. */
	readonly code: MemoryGatewayTransportFailureCode;

	/** Creates a transport failure that names only its bounded class. */
	constructor(code: MemoryGatewayTransportFailureCode)
	{
		super(`Memory gateway transport failed: ${code}`);
		this.name = "MemoryGatewayTransportError";
		this.code = code;
	}
}

/** Typed failure raised when the gateway explicitly refused an otherwise well-formed request. */
export class MemoryGatewayRemoteRefusalError extends Error
{
	/** Creates a refusal that names only the operation, never the content that was refused. */
	constructor(operation: string)
	{
		super(`Memory gateway refused the operation: ${operation}`);
		this.name = "MemoryGatewayRemoteRefusalError";
	}
}

/** Validate and normalize the in-cluster Cognee origin. */
export function __CogneeBaseUrl(value: string): URL
{
	const parsed = URL.parse(value);
	if (!parsed || parsed.protocol !== "http:" || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "" || parsed.username !== "" || parsed.password !== "")
	{
		throw new Error("MEMORY_GATEWAY_URL must be one in-cluster HTTP origin with no path or credentials");
	}
	return parsed;
}

/** Read one Cognee response without allocating beyond the fixed protocol ceiling. */
async function _ReadBoundedText(response: Response): Promise<string>
{
	const declaredLength = response.headers.get("content-length");
	if (declaredLength !== null)
	{
		const parsedLength = Number(declaredLength);
		if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > _MAX_RESPONSE_BYTES)
		{
			await response.body?.cancel();
			throw new MemoryGatewayTransportError("oversize");
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
			throw new MemoryGatewayTransportError("oversize");
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
	if (error instanceof MemoryGatewayTransportError || error instanceof MemoryGatewayProtocolError || error instanceof MemoryGatewayRemoteRefusalError) throw error;
	const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
	throw new MemoryGatewayTransportError(isTimeout ? "timeout" : "network");
}

/** Read the rotating server token without retaining a stale projected credential in process memory. */
function _CreateServerTokenReader(tokenFile: string): () => Promise<string>
{
	return async function _readServerToken(): Promise<string>
	{
		const token = await readFile(tokenFile, "utf8");
		if (token.trim().length === 0) throw new Error("mounted memory-gateway token is empty");
		return token.trim();
	};
}

/**
 * Create the authenticated Cognee exchange used by every memory-gateway operation.
 *
 * Every exchange presents a freshly read, audience-bound projected ServiceAccount token. The memory
 * gateway TokenReviews it and admits only the OpenCrane server identity; Cognee itself remains
 * private and unauthenticated. Every fetch runs with automatic child tracing suppressed so bearer
 * headers and remote addresses cannot become child-span attributes. The caller's explicit
 * memory-gateway operation span remains active.
 *
 * @param options - Gateway origin, timeout, projected token, and test seams.
 * @returns A session issuing bounded, timeout-guarded JSON exchanges.
 */
export function __CreateCogneeSession(options: CogneeMemoryGatewayHttpOptions): CogneeSession
{
	const baseUrl = __CogneeBaseUrl(options.baseUrl);
	const fetchRequest: CogneeFetch = options.fetch ?? fetch;
	const readServerToken = options.readServerToken ?? _CreateServerTokenReader(options.serverTokenFile);

	/** Issue one exchange with the supplied token, returning the raw response. */
	async function _Send(path: string, method: string, body: unknown): Promise<Response>
	{
		const headers = new Headers({ accept: "application/json" });
		if (body !== undefined) headers.set("content-type", "application/json");
		headers.set("authorization", `Bearer ${await readServerToken()}`);
		try
		{
			return await ___DoWithoutTrace(function _fetchSensitiveEndpoint()
			{
				return fetchRequest(new URL(path, baseUrl), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(options.requestTimeoutMilliseconds), redirect: "error" });
			});
		}
		catch (error)
		{
			return _ThrowTransportFailure(error);
		}
	}

	return {
		async request(path: string, method: string, body: unknown): Promise<unknown>
		{
			const response = await _Send(path, method, body);
			if (!response.ok)
			{
				await response.body?.cancel();
				throw new MemoryGatewayTransportError(`http_${response.status}`);
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

/** Parse untrusted Cognee JSON into an unknown value, failing as a protocol violation. */
function _ParseJson(text: string): unknown
{
	try
	{
		return JSON.parse(text) as unknown;
	}
	catch
	{
		throw new MemoryGatewayProtocolError("Memory gateway returned malformed JSON");
	}
}
