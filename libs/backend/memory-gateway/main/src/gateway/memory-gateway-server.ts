import { createServer } from "node:http";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import { MemoryGatewayErrorCodes } from "@opencrane/contracts";

import { _CreateCogneeMemoryGatewayProviderOperations } from "../provider/operations/cognee-memory-gateway-provider-operations";
import { _MemoryGatewayBearer, _ReadMemoryGatewayBody } from "./memory-gateway-request";
import { _FindMemoryGatewayRoute, _MemoryGatewayPostRoutes } from "./memory-gateway-routes";
import { _MemoryGatewayFailureCode, _RefuseMemoryGatewayRequest, _WriteMemoryGatewayFailure, _WriteMemoryGatewayJson } from "./memory-gateway-response";
import type { MemoryGatewayServer, MemoryGatewayServerOptions } from "./memory-gateway-server.types";

/**
 * Create the private memory HTTP boundary around the accepted server identity and one provider session.
 *
 * Authentication precedes body reads and every operation validates shared requests and responses.
 * The gateway translates individual provider operations; the personal-memory workflow retains all
 * sequencing, consent and catalog decisions. Mutation errors preserve delivery uncertainty so a
 * lost response cannot silently become permission to repeat a write.
 *
 * Called by: apps/memory-gateway/src/index.ts during process startup.
 * @param options - Workload reviewer, provider session and content-free app logger.
 * @returns A server the owning app must start and close with its process lifecycle.
 */
export function __CreateMemoryGatewayServer(options: MemoryGatewayServerOptions): MemoryGatewayServer
{
	const operations = options.providerOperations ?? _CreateCogneeMemoryGatewayProviderOperations(options.providerSession);
	const posts = _MemoryGatewayPostRoutes(operations);
	return createServer(function _Handle(request, response)
	{
		const path = (request.url ?? "/").split("?", 1)[0];
		const method = request.method ?? "";
		const route = _FindMemoryGatewayRoute(operations, posts, method, path);
		const probe = method === "GET" && (path === "/livez" || path === "/readyz");
		const logPath = route?.path ?? (probe ? path : "unmatched");
		const controller = new AbortController();
		/** Cancel provider I/O when the caller disconnects before receiving a response. */
		function _Disconnected(): void
		{
			if (!response.writableEnded)
				controller.abort();
		}
		response.once("close", _Disconnected);
		void ___DoWithTrace("memory_gateway.request", { method, path: logPath }, async function _Request(): Promise<void>
		{
			let enteredOperation = false;
			try
			{
				if (probe)
				{
					if (path === "/readyz")
						await options.providerSession.ensureReady();
					response.writeHead(204);
					response.end();
					return;
				}
				if (route === null)
					return _RefuseMemoryGatewayRequest(response, MemoryGatewayErrorCodes.NotFound, false);
				const token = _MemoryGatewayBearer(request);
				if (token === null || await options.tokenReviewer.__Review(token) === null)
					return _RefuseMemoryGatewayRequest(response, MemoryGatewayErrorCodes.Unauthorized, route.mutation);

				// The server identity must be accepted before any fact text is read or provider work starts.
				const body = await _ReadMemoryGatewayBody(request, route.pathOnly);
				const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]);
				signal.throwIfAborted();
				enteredOperation = true;
				const result = await route.execute(body, signal);
				_WriteMemoryGatewayJson(response, 200, result);
			}
			catch (error)
			{
				const code = _MemoryGatewayFailureCode(error);
				options.log.error({ err: new Error(code), path: logPath }, "memory gateway request failed");
				_WriteMemoryGatewayFailure(response, error, route?.mutation ?? false, enteredOperation);
			}
			finally
			{
				response.off("close", _Disconnected);
			}
		});
	});
}
