import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { ___DoWithTrace, ___DoWithoutTrace } from "@opencrane/backend/observability";
import type { FixedServiceAccountTokenReviewer } from "@opencrane/backend/server/infra/workload-identity";

import type { MemoryGatewayProcessConfig } from "./config.types";
import { _log as log } from "./log";
import { _ValidateSearchRequest, MemorySearchContractViolation } from "./search-contract";

/** Largest JSON body accepted from the OpenCrane server for one memory operation. */
const _MAX_REQUEST_BYTES = 1024 * 1024;

/** The one read-only Cognee route this gateway mediates; the forwarded URL is built from this constant. */
const _SEARCH_PATH = "/api/v1/search";

/** Return whether a request is the one read-only Cognee operation this gateway mediates. */
function _IsAllowedPath(path: string, method: string): boolean
{
	return method === "POST" && path === _SEARCH_PATH;
}

/** Extract one bearer token without accepting a duplicate or empty credential. */
function _BearerToken(request: IncomingMessage): string | null
{
	const header = request.headers.authorization;
	if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
	const token = header.slice("Bearer ".length).trim();
	return token.length > 0 ? token : null;
}

/** Read one size-capped raw HTTP body, leaving the server-authorized JSON exactly as sent. */
async function _ReadBody(request: IncomingMessage): Promise<Buffer>
{
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	for await (const chunk of request)
	{
		const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
		byteLength += bytes.byteLength;
		if (byteLength > _MAX_REQUEST_BYTES) throw new RangeError("memory request exceeds byte limit");
		chunks.push(bytes);
	}
	return Buffer.concat(chunks, byteLength);
}

/** Write the bounded Cognee response while preserving its JSON status and never exposing headers. */
async function _WriteResponse(target: ServerResponse, source: Response): Promise<void>
{
	const body = await _ReadResponseBody(source);
	target.writeHead(source.status, { "content-type": source.headers.get("content-type") ?? "application/json", "content-length": String(body.byteLength) });
	target.end(body);
}

/** Read one Cognee response incrementally so a malicious upstream cannot exhaust gateway memory. */
async function _ReadResponseBody(source: Response): Promise<Buffer>
{
	if (source.body === null) return Buffer.alloc(0);
	const reader = source.body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	try
	{
		while (true)
		{
			const result = await reader.read();
			if (result.done) return Buffer.concat(chunks, byteLength);
			byteLength += result.value.byteLength;
			if (byteLength > _MAX_REQUEST_BYTES)
			{
				await reader.cancel();
				throw new RangeError("memory response exceeds byte limit");
			}
			chunks.push(result.value);
		}
	}
	finally
	{
		reader.releaseLock();
	}
}

/** Create the private memory gateway: authenticated server traffic in, unauthenticated Cognee traffic out. */
export function _CreateServer(config: MemoryGatewayProcessConfig, tokenReviewer: FixedServiceAccountTokenReviewer): Server
{
	return createServer(function _handle(request, response)
	{
		const path = new URL(request.url ?? "/", "http://localhost").pathname;
		void ___DoWithTrace("memory_gateway.request", { method: request.method ?? "UNKNOWN", path }, async function _request(): Promise<void>
		{
			try
			{
				// 1. Serve local health probes before authentication; they reveal no Cognee state or data.
				if (path === "/livez" || path === "/readyz")
				{
					response.writeHead(204);
					response.end();
					return;
				}

				// 2. Restrict the route before reading bytes so this is not a general Cognee relay.
				if (!_IsAllowedPath(path, request.method ?? "")) return _Respond(response, 404);
				const token = _BearerToken(request);
				if (token === null || await tokenReviewer.__Review(token) === null) return _Respond(response, 401);

				// 3. Read the bounded body, then enforce the gateway-owned search contract so only a
				//    canonical re-serialization of validated fields can transit to Cognee.
				const body = await _ReadBody(request);
				const canonicalBody = _ValidateSearchRequest(body);

				// 4. Reach the private Cognee Service on the fixed allowlisted route with no caller
				//    credentials or arbitrary headers; nothing request-derived selects the URL or method.
				const upstream = await ___DoWithoutTrace(function _forward()
				{
					return fetch(new URL(_SEARCH_PATH, config.cogneeUrl), { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: new Uint8Array(canonicalBody), signal: AbortSignal.timeout(config.requestTimeoutMilliseconds), redirect: "error" });
				});
				await _WriteResponse(response, upstream);
			}
			catch (error)
			{
				log.error({ err: error, path }, "memory gateway request failed");
				_Respond(response, _ErrorStatus(error));
			}
		});
	});
}

/** Map internal failures to the small fixed set of public statuses the gateway returns. */
function _ErrorStatus(error: unknown): number
{
	if (error instanceof MemorySearchContractViolation) return 422;
	if (error instanceof RangeError) return 413;
	return 502;
}

/** Map one public status to its stable response code. */
function _ErrorCode(status: number): string
{
	switch (status)
	{
		case 401: return "unauthorized";
		case 404: return "not_found";
		case 422: return "invalid_search";
		default: return "memory_gateway_unavailable";
	}
}

/** Write a status-only refusal without exposing provider details. */
function _Respond(response: ServerResponse, status: number): void
{
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify({ error: _ErrorCode(status) }));
}
