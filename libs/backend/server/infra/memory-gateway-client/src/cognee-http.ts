import { readFile } from "node:fs/promises";

import { ___DoWithoutTrace } from "@opencrane/backend/observability";
import { ___MemoryGatewayMutationErrorSchema, ___MemoryGatewayReadErrorSchema, MemoryGatewayErrorCodes, MemoryMutationDeliveryStates } from "@opencrane/contracts";

import { MemoryGatewayMutationFailure, MemoryGatewayProtocolError, MemoryGatewayReadFailure, MemoryGatewayTransportError } from "./memory-gateway-errors";
import { MemoryGatewayRequestKinds } from "./http-cognee-memory-gateway-client.types";
import type { CogneeFetch, CogneeMemoryGatewayHttpOptions, CogneeSession, MemoryGatewayFailureDelivery, MemoryGatewayHttpCommand } from "./http-cognee-memory-gateway-client.types";

/** Response ceiling that accepts the largest highly escaped shared search response. */
const _MAXIMUM_RESPONSE_BYTES = 8 * 1024 * 1024;

/** Stable gateway failure required for each non-success HTTP status. */
const _ERROR_CODE_BY_STATUS = new Map<number, MemoryGatewayErrorCodes>([
	[401, MemoryGatewayErrorCodes.Unauthorized],
	[404, MemoryGatewayErrorCodes.NotFound],
	[409, MemoryGatewayErrorCodes.Conflict],
	[422, MemoryGatewayErrorCodes.InvalidRequest],
	[502, MemoryGatewayErrorCodes.ProviderProtocol],
	[503, MemoryGatewayErrorCodes.ProviderUnavailable],
]);

/** Parses the release-local memory-gateway Service origin. */
function _MemoryGatewayOrigin(value: string): URL
{
	const parsed = URL.parse(value);
	if (parsed === null || parsed.protocol !== "http:" || !parsed.hostname.endsWith(".svc.cluster.local") || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "" || parsed.username !== "" || parsed.password !== "")
		throw new Error("MEMORY_GATEWAY_URL must be one release-local Kubernetes Service HTTP origin with no path or credentials");
	return parsed;
}

/** Returns mutation delivery evidence and leaves read failures unclassified. */
function _Delivery(kind: MemoryGatewayRequestKinds, dispatched: boolean): MemoryGatewayFailureDelivery
{
	if (kind === MemoryGatewayRequestKinds.Read)
		return undefined;
	return dispatched ? MemoryMutationDeliveryStates.Ambiguous : MemoryMutationDeliveryStates.ProvenNotSent;
}

/** Creates a protocol failure with the request's current delivery evidence. */
function _Protocol(command: MemoryGatewayHttpCommand, dispatched: boolean): MemoryGatewayProtocolError
{
	const error = dispatched ? MemoryGatewayErrorCodes.ProviderProtocol : MemoryGatewayErrorCodes.InvalidRequest;
	return new MemoryGatewayProtocolError(error, _Delivery(command.kind, dispatched));
}

/** Reads the rotating server token without retaining a stale projected credential. */
function _CreateServerTokenReader(tokenFile: string): () => Promise<string>
{
	return async function _ReadServerToken(): Promise<string>
	{
		const token = await readFile(tokenFile, "utf8");
		if (token.trim().length === 0)
			throw new Error("mounted token is empty");
		return token.trim();
	};
}

/** Reads a complete response while the request timeout remains active. */
async function _ReadBoundedBody(response: Response, signal: AbortSignal, command: MemoryGatewayHttpCommand): Promise<Uint8Array>
{
	const declared = response.headers.get("content-length");
	if (declared !== null)
	{
		const parsed = Number(declared);
		if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > _MAXIMUM_RESPONSE_BYTES)
		{
			if (response.body !== null)
				void Promise.allSettled([response.body.cancel()]);
			throw new MemoryGatewayTransportError("response_too_large", _Delivery(command.kind, true));
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
			if (byteLength > _MAXIMUM_RESPONSE_BYTES)
			{
				void Promise.allSettled([reader.cancel()]);
				throw new MemoryGatewayTransportError("response_too_large", _Delivery(command.kind, true));
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

/** Parses strict UTF-8 JSON without retaining response text in a thrown error. */
function _Json(body: Uint8Array, command: MemoryGatewayHttpCommand, dispatched: boolean): unknown
{
	try
	{
		const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
		return JSON.parse(text) as unknown;
	}
	catch
	{
		throw _Protocol(command, dispatched);
	}
}

/** Requires the JSON media type used by every stable gateway response. */
function _RequireJson(response: Response, command: MemoryGatewayHttpCommand): void
{
	const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
	if (mediaType !== "application/json")
		throw _Protocol(command, true);
}

/** Throws a strict gateway error whose body agrees with its HTTP status. */
function _ThrowGatewayError(response: Response, body: Uint8Array, command: MemoryGatewayHttpCommand): never
{
	_RequireJson(response, command);
	const expectedCode = _ERROR_CODE_BY_STATUS.get(response.status);
	if (expectedCode === undefined)
		throw _Protocol(command, true);
	const payload = _Json(body, command, true);
	if (command.kind === MemoryGatewayRequestKinds.Read)
	{
		const parsed = ___MemoryGatewayReadErrorSchema.safeParse(payload);
		if (!parsed.success || parsed.data.error !== expectedCode)
			throw _Protocol(command, true);
		throw new MemoryGatewayReadFailure(parsed.data.error);
	}
	const parsed = ___MemoryGatewayMutationErrorSchema.safeParse(payload);
	if (!parsed.success || parsed.data.error !== expectedCode)
		throw _Protocol(command, true);
	throw new MemoryGatewayMutationFailure(parsed.data.error, parsed.data.deliveryState);
}

/** Converts an exchange exception into a content-free failure. */
function _ThrowExchangeFailure(error: unknown, signal: AbortSignal, command: MemoryGatewayHttpCommand): never
{
	if (error instanceof MemoryGatewayTransportError || error instanceof MemoryGatewayProtocolError || error instanceof MemoryGatewayReadFailure || error instanceof MemoryGatewayMutationFailure)
		throw error;
	if (signal.aborted)
	{
		const reasonName = signal.reason instanceof Error ? signal.reason.name : "";
		const code = reasonName === "TimeoutError" ? "timeout" : "aborted";
		throw new MemoryGatewayTransportError(code, _Delivery(command.kind, true));
	}
	throw new MemoryGatewayTransportError("network", _Delivery(command.kind, true));
}

/**
 * Creates the authenticated transport used by every stable memory-gateway operation.
 *
 * The transport re-reads the projected server token for each exchange, refuses redirects, bounds
 * the complete response, and keeps the timeout active while consuming its body. It never retries.
 * A mutation that fails before fetch is `ProvenNotSent`; any failure after fetch starts is
 * `Ambiguous`. Errors retain no token, request content, URL, response body, or original cause.
 *
 * Called by: `__CreateHttpCogneeMemoryGatewayClient`.
 *
 * @param options - Private Service origin, timeout, projected-token path, and test seams.
 * @returns One authenticated request-at-a-time transport.
 * @throws Error When the origin or timeout cannot satisfy the private transport contract.
 */
export function __CreateCogneeSession(options: CogneeMemoryGatewayHttpOptions): CogneeSession
{
	const origin = _MemoryGatewayOrigin(options.baseUrl);
	if (!Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1_000 || options.requestTimeoutMilliseconds > 300_000)
		throw new Error("Memory gateway client requires a 1-300s request timeout");
	const fetchRequest: CogneeFetch = options.fetch ?? fetch;
	const readServerToken = options.readServerToken ?? _CreateServerTokenReader(options.serverTokenFile);

	return {
		async send(command: MemoryGatewayHttpCommand)
		{
			let token: string;
			try
			{
				token = (await readServerToken()).trim();
				if (token.length === 0 || token.length > 65_536 || !/^[A-Za-z0-9._~-]+$/u.test(token))
					throw new Error("mounted token is invalid");
			}
			catch
			{
				throw new MemoryGatewayTransportError("token_unavailable", _Delivery(command.kind, false));
			}
			let body: string | undefined;
			try
			{
				body = command.body === undefined ? undefined : JSON.stringify(command.body);
			}
			catch
			{
				throw _Protocol(command, false);
			}
			let headers: Headers;
			try
			{
				headers = new Headers({ accept: "application/json", authorization: `Bearer ${token}` });
				if (body !== undefined)
					headers.set("content-type", "application/json");
			}
			catch
			{
				throw new MemoryGatewayTransportError("token_unavailable", _Delivery(command.kind, false));
			}
			const signal = AbortSignal.timeout(options.requestTimeoutMilliseconds);
			try
			{
				return await ___DoWithoutTrace(async function _SendAndConsumeMemoryGatewayResponse()
				{
					const response = await fetchRequest(new URL(command.path, origin), { method: command.method, headers, body, signal, redirect: "error" });
					const responseBody = await _ReadBoundedBody(response, signal, command);
					if (response.status !== 200)
						return _ThrowGatewayError(response, responseBody, command);
					_RequireJson(response, command);
					return { body: _Json(responseBody, command, true) };
				});
			}
			catch (error)
			{
				return _ThrowExchangeFailure(error, signal, command);
			}
		},
	};
}
