import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import * as k8s from "@kubernetes/client-node";
import { ___DoWithTrace, ___DoWithoutTrace } from "@opencrane/observability";

import type { MemoryGatewayProcessConfig } from "./config.types.js";
import { _log as log } from "./log.js";
import type { TokenReviewApi } from "./server.types.js";

/** Largest JSON body accepted from the OpenCrane server for one memory operation. */
const _MAX_REQUEST_BYTES = 1024 * 1024;

/** Return whether a request path is one of the narrow Cognee operations this gateway mediates. */
function _IsAllowedPath(path: string, method: string): boolean
{
	return (method === "POST" && (path === "/api/v1/search" || path === "/api/v1/add" || path === "/api/v1/cognify")) || (method === "DELETE" && /^\/api\/v1\/datasets\/[^/]+\/data\/[^/]+$/.test(path));
}

/** Extract one bearer token without accepting a duplicate or empty credential. */
function _BearerToken(request: IncomingMessage): string | null
{
	const header = request.headers.authorization;
	if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
	const token = header.slice("Bearer ".length).trim();
	return token.length > 0 ? token : null;
}

/** TokenReview the caller and require the exact same-namespace OpenCrane server ServiceAccount. */
async function _VerifyServer(api: TokenReviewApi, token: string, config: MemoryGatewayProcessConfig): Promise<boolean>
{
	const body = new k8s.V1TokenReview();
	body.spec = new k8s.V1TokenReviewSpec();
	body.spec.token = token;
	body.spec.audiences = [config.serverTokenAudience];
	const response = await api.createTokenReview({ body });
	const status = response.status;
	return status?.authenticated === true && status.user?.username === `system:serviceaccount:${config.namespace}:${config.serverServiceAccountName}` && status.audiences?.includes(config.serverTokenAudience) === true;
}

/** Read one bounded raw HTTP body without parsing or changing the server-authorized JSON payload. */
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
export function _CreateServer(config: MemoryGatewayProcessConfig, tokenReviewApi: TokenReviewApi): Server
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
				if (token === null || !await _VerifyServer(tokenReviewApi, token, config)) return _Respond(response, 401);

				// 3. Preserve only the server-authorized body, bounded at the proxy boundary.
				const body = request.method === "DELETE" ? undefined : await _ReadBody(request);

				// 4. Reach the private Cognee Service with no caller credentials or arbitrary headers.
				const upstream = await ___DoWithoutTrace(function _forward()
				{
					return fetch(new URL(path, config.cogneeUrl), { method: request.method, headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" }, body: body === undefined ? undefined : new Uint8Array(body), signal: AbortSignal.timeout(config.requestTimeoutMilliseconds), redirect: "error" });
				});
				await _WriteResponse(response, upstream);
			}
			catch (error)
			{
				log.error({ err: error, path }, "memory gateway request failed");
				_Respond(response, error instanceof RangeError ? 413 : 502);
			}
		});
	});
}

/** Write a status-only refusal without exposing provider details. */
function _Respond(response: ServerResponse, status: number): void
{
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify({ error: status === 401 ? "unauthorized" : status === 404 ? "not_found" : "memory_gateway_unavailable" }));
}
