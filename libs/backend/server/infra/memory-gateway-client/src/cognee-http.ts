import { readFile } from "node:fs/promises";

import { ___DoWithoutTrace } from "@opencrane/backend/observability";

import { MemoryGatewayProtocolError } from "./personal-memory-record";
import type { CogneeFetch, CogneeMemoryGatewayHttpOptions, CogneeSession, MemoryGatewayTransportFailureCode } from "./http-cognee-memory-gateway-client.types";

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
	/** Which kind of failure it was. It carries no remote content, so it is safe to log or store as an invocation's failure code. */
	readonly code: MemoryGatewayTransportFailureCode;

	/** Creates a transport failure that names only its bounded class. */
	constructor(code: MemoryGatewayTransportFailureCode)
	{
		super(`Memory gateway transport failed: ${code}`);
		this.name = "MemoryGatewayTransportError";
		this.code = code;
	}
}

/** Check that the configured gateway URL is one in-cluster Kubernetes Service origin, and return it parsed. */
function _MemoryGatewayOrigin(value: string): URL
{
	const parsed = URL.parse(value);
	if (!parsed || parsed.protocol !== "http:" || !parsed.hostname.endsWith(".svc.cluster.local") || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "" || parsed.username !== "" || parsed.password !== "")
	{
		throw new Error("MEMORY_GATEWAY_URL must be one release-local Kubernetes Service HTTP origin with no path or credentials");
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
	if (error instanceof MemoryGatewayTransportError || error instanceof MemoryGatewayProtocolError) throw error;
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
 * Create the authenticated exchange the memory-gateway client uses for read-only search.
 *
 * Every exchange re-reads the projected ServiceAccount token and sends it as a bearer token. The
 * memory gateway checks that token with a Kubernetes TokenReview and admits only the OpenCrane
 * server identity; Cognee itself sits behind the gateway, private and unauthenticated, so the
 * gateway is the only thing that ever authorizes a search. Every fetch runs with automatic child
 * tracing switched off so the bearer header and the remote address cannot become span attributes;
 * the caller's own memory-gateway span stays active. The token audience is
 * `MEMORY_GATEWAY_PROJECTED_TOKEN_AUDIENCE` in libs/contracts/src/memory.types.ts.
 *
 * Called by: http-cognee-memory-gateway-client.ts, which builds one session per client.
 *
 * @param options - Gateway origin, per-exchange timeout, projected-token path, and the optional
 *   fetch and token-reader overrides used by tests.
 * @returns A session with a single `search` method — the only call allowed against Cognee.
 * @throws Error When the origin is not a single in-cluster HTTP Service origin, or the mounted token
 *   file is empty when it is first read.
 * @see NEEDS-HUMAN - add the URI for the Kubernetes TokenReview API
 *   (`authentication.k8s.io/v1`) that the "admits only the OpenCrane server identity" claim rests
 *   on; I could not confirm the exact upstream doc URL.
 */
export function __CreateCogneeSession(options: CogneeMemoryGatewayHttpOptions): CogneeSession
{
	const baseUrl = _MemoryGatewayOrigin(options.baseUrl);
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
		async search(body: unknown): Promise<unknown>
		{
			const response = await _Send("/api/v1/search", "POST", body);
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
