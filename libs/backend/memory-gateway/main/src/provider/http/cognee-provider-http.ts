import { ___DoWithoutTrace } from "@opencrane/backend/observability";

import { CogneeProviderSessionError } from "../auth/cognee-provider-session-error";
import { CogneeProviderSessionFailureCodes } from "../auth/cognee-provider-session.types";
import type { CogneeProviderHttpClient, CogneeProviderHttpCommand, CogneeProviderHttpOptions, CogneeProviderHttpResponse } from "./cognee-provider-http.types";

/** Headers that would bypass or destabilize the session-owned authenticated request. */
const _FORBIDDEN_HEADERS = new Set(["authorization", "connection", "content-length", "cookie", "host", "proxy-authorization", "transfer-encoding"]);

/** Parse a provider origin while excluding embedded credentials and path state. */
function _ProviderOrigin(value: string): URL
{
	const parsed = URL.parse(value);
	if (parsed === null || !["http:", "https:"].includes(parsed.protocol) || parsed.username !== "" || parsed.password !== "" || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "")
		throw new CogneeProviderSessionError(CogneeProviderSessionFailureCodes.UnsafeRequest);
	return parsed;
}

/** Validate a request path before credential loading or network activity. */
export function _ValidateCogneeProviderHttpCommand(command: CogneeProviderHttpCommand, origin: URL): URL
{
	if (!command.path.startsWith("/") || command.path.startsWith("//"))
		throw new CogneeProviderSessionError(CogneeProviderSessionFailureCodes.UnsafeRequest);
	const target = new URL(command.path, origin);
	if (target.origin !== origin.origin || target.hash !== "")
		throw new CogneeProviderSessionError(CogneeProviderSessionFailureCodes.UnsafeRequest);
	for (const name of Object.keys(command.headers ?? {}))
	{
		if (_FORBIDDEN_HEADERS.has(name.toLowerCase()))
			throw new CogneeProviderSessionError(CogneeProviderSessionFailureCodes.UnsafeRequest);
	}
	return target;
}

/** Convert replayable caller bytes into a fresh fetch body for this attempt. */
function _RequestBody(body: string | Uint8Array | undefined): BodyInit | undefined
{
	if (body === undefined || typeof body === "string")
		return body;
	return body.slice() as BodyInit;
}

/** Build request headers while mapping invalid caller values to one safe outcome. */
function _RequestHeaders(command: CogneeProviderHttpCommand, bearerToken: string | undefined): Headers
{
	try
	{
		const headers = new Headers(command.headers);
		if (!headers.has("accept"))
			headers.set("accept", "application/json");
		if (bearerToken !== undefined)
			headers.set("authorization", `Bearer ${bearerToken}`);
		return headers;
	}
	catch
	{
		throw new CogneeProviderSessionError(CogneeProviderSessionFailureCodes.UnsafeRequest);
	}
}

/** Classify a rejected fetch or body read without retaining the thrown value. */
function _ThrowExchangeFailure(error: unknown, signal: AbortSignal): never
{
	if (error instanceof CogneeProviderSessionError)
		throw error;
	if (signal.aborted)
	{
		const reasonName = signal.reason instanceof Error ? signal.reason.name : "";
		const code = reasonName === "TimeoutError" ? CogneeProviderSessionFailureCodes.Timeout : CogneeProviderSessionFailureCodes.Aborted;
		throw new CogneeProviderSessionError(code);
	}
	throw new CogneeProviderSessionError(CogneeProviderSessionFailureCodes.Network);
}

/** Consume one response while cancellation remains attached to its reader. */
async function _ReadBoundedResponse(response: Response, maximumBytes: number, signal: AbortSignal): Promise<Uint8Array>
{
	const declared = response.headers.get("content-length");
	if (declared !== null)
	{
		const parsed = Number(declared);
		if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximumBytes)
		{
			if (response.body !== null)
				await Promise.allSettled([response.body.cancel()]);
			throw new CogneeProviderSessionError(CogneeProviderSessionFailureCodes.ResponseTooLarge);
		}
	}
	if (response.body === null)
		return new Uint8Array();

	const reader = response.body.getReader();
	let aborted = signal.aborted;
	function _AbortRead(): void
	{
		aborted = true;
		void Promise.allSettled([reader.cancel()]);
	}
	signal.addEventListener("abort", _AbortRead, { once: true });
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	try
	{
		while (true)
		{
			if (aborted)
				signal.throwIfAborted();
			const result = await reader.read();
			if (aborted)
				signal.throwIfAborted();
			if (result.done)
				break;
			byteLength += result.value.byteLength;
			if (byteLength > maximumBytes)
			{
				await Promise.allSettled([reader.cancel()]);
				throw new CogneeProviderSessionError(CogneeProviderSessionFailureCodes.ResponseTooLarge);
			}
			chunks.push(result.value);
		}
	}
	finally
	{
		signal.removeEventListener("abort", _AbortRead);
	}

	const body = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks)
	{
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

/** Build one bounded provider HTTP client with no authentication state of its own. */
export function _CreateCogneeProviderHttpClient(options: CogneeProviderHttpOptions): CogneeProviderHttpClient
{
	const origin = _ProviderOrigin(options.baseUrl);
	if (!Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds <= 0 || !Number.isSafeInteger(options.maximumResponseBytes) || options.maximumResponseBytes <= 0)
		throw new CogneeProviderSessionError(CogneeProviderSessionFailureCodes.UnsafeRequest);
	const fetchRequest = options.fetch ?? fetch;

	return {
		async send(command: CogneeProviderHttpCommand, bearerToken?: string): Promise<CogneeProviderHttpResponse>
		{
			const target = _ValidateCogneeProviderHttpCommand(command, origin);
			const headers = _RequestHeaders(command, bearerToken);
			const timeoutSignal = AbortSignal.timeout(options.requestTimeoutMilliseconds);
			const signal = command.signal === undefined ? timeoutSignal : AbortSignal.any([command.signal, timeoutSignal]);
			try
			{
				return await ___DoWithoutTrace(async function _SendAndConsumeProviderResponse(): Promise<CogneeProviderHttpResponse>
				{
					const response = await fetchRequest(target, { method: command.method, headers, body: _RequestBody(command.body), signal, redirect: "error" });
					const body = await _ReadBoundedResponse(response, options.maximumResponseBytes, signal);
					return { status: response.status, contentType: response.headers.get("content-type"), body };
				});
			}
			catch (error)
			{
				return _ThrowExchangeFailure(error, signal);
			}
		},
	};
}
