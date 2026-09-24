import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import { ___DoWithTrace } from "@opencrane/backend/observability";

import type { MemoryGatewayServer, MemoryGatewayServerOptions } from "./memory-gateway-server.types";
import { _ValidateSearchRequest, MemorySearchContractViolation } from "./memory-gateway-search-contract";
import { _ProjectCogneeSearchResponse } from "../provider/operations/cognee-search-response";

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
	if (typeof header !== "string" || !header.startsWith("Bearer "))
		return null;
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
		if (byteLength > _MAX_REQUEST_BYTES)
			throw new RangeError("memory request exceeds byte limit");
		chunks.push(bytes);
	}
	return Buffer.concat(chunks, byteLength);
}

/** Write one canonical gateway response without forwarding provider headers. */
function _WriteResponse(target: ServerResponse, body: Uint8Array): void
{
	target.writeHead(200, { "content-type": "application/json", "content-length": String(body.byteLength) });
	target.end(body);
}

/**
 * Create the private memory gateway around one workload reviewer and authenticated Cognee session.
 *
 * Health probes reveal no provider state beyond availability. Search reads request bytes only after
 * the fixed server identity is accepted, forwards one canonical request through the session owner,
 * and returns only chunks from an exact matching dataset envelope. Callers must keep the returned
 * server private to the silo and close it before app telemetry shuts down.
 *
 * Called by: apps/memory-gateway/src/index.ts during process startup.
 *
 * @param options - Token reviewer, authenticated provider session, and content-free logger.
 * @returns A Node HTTP server that has not started listening.
 * @throws Error Only for synchronous Node server construction failures.
 */
export function __CreateMemoryGatewayServer(options: MemoryGatewayServerOptions): MemoryGatewayServer
{
	return createServer(function _handle(request, response)
	{
		const path = new URL(request.url ?? "/", "http://localhost").pathname;
		void ___DoWithTrace("memory_gateway.request", { method: request.method ?? "UNKNOWN", path }, async function _request(): Promise<void>
		{
			try
			{
				// 1. Liveness proves only that the local listener can answer.
				if (path === "/livez")
				{
					response.writeHead(204);
					response.end();
					return;
				}
				// 2. Readiness proves the mounted identity can establish an authenticated provider session.
				if (path === "/readyz")
				{
					await options.providerSession.ensureReady();
					response.writeHead(204);
					response.end();
					return;
				}

				// 3. Restrict the route before reading bytes so this cannot become a general Cognee relay.
				if (!_IsAllowedPath(path, request.method ?? ""))
					return _Respond(response, 404);
				const token = _BearerToken(request);
				if (token === null || await options.tokenReviewer.__Review(token) === null)
					return _Respond(response, 401);

				// 4. Read the bounded body, then enforce the gateway-owned search contract so only a
				//    canonical re-serialization of validated fields can transit to Cognee.
				const body = await _ReadBody(request);
				const search = _ValidateSearchRequest(body);

				// 5. The session adds its bearer and bounds the provider exchange. The response adapter
				//    then proves the provider echoed the same dataset before any chunks leave this process.
				const upstream = await options.providerSession.exchange({ method: "POST", path: _SEARCH_PATH, headers: { "content-type": "application/json" }, body: search.body });
				const projected = _ProjectCogneeSearchResponse(upstream, search.datasetId);
				_WriteResponse(response, projected);
			}
			catch (error)
			{
				const status = _FailureStatus(path, error);
				options.log.error({ err: new Error(_ErrorCode(status)), path }, "memory gateway request failed");
				_Respond(response, status);
			}
		});
	});
}

/** Return 503 for a failed provider readiness probe and the ordinary request status otherwise. */
function _FailureStatus(path: string, error: unknown): number
{
	if (path === "/readyz")
		return 503;
	return _ErrorStatus(error);
}

/** Map internal failures to the small fixed set of public statuses the gateway returns. */
function _ErrorStatus(error: unknown): number
{
	if (error instanceof MemorySearchContractViolation)
		return 422;
	if (error instanceof RangeError)
		return 413;
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
