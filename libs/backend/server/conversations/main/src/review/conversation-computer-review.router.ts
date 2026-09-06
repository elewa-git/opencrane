import { Router, type Request, type Response } from "express";
import { ProductAuthorizationActions } from "@opencrane/models/authorization";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import type { ConversationComputerReviewPrincipalResolver, ConversationComputerReviewRouterOptions } from "./conversation-computer-review.types";

/** Largest response accepted from a sandbox review gateway. */
const _MAX_RESPONSE_BYTES = 1024 * 1024;
/** Fixed review port owned by the 0.11 conversation-computer image. */
const _REVIEW_PORT = 8090;
/** Release-owned localhost ports eligible for temporary preview review. */
const _PREVIEW_PORTS = new Set([3000, 4173, 4200, 5173, 8000]);
/** DNS label accepted from the controller-owned Sandbox status. */
const _DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/**
 * Mounts the authenticated human-review API for an active conversation computer.
 *
 * File, diff, and browser discovery routes request `Read`; commands, page creation, screenshots, and
 * localhost responses request `Use`. Every route resolves its upstream host and derived review
 * credential on the server, so public request fields cannot select a sandbox or its Service address.
 *
 * Called by: `_CreateRoutes` in `apps/opencrane/src/app/routes.ts` when computer history and the Agent
 * Sandbox release profile are configured.
 *
 * @param options - Supplies admission, the allowed sandbox namespace, structured failure logging, and an optional test transport.
 * @param resolvePrincipal - Resolves identity from the authenticated Express request.
 * @returns An Express router whose responses are size-limited and never cached.
 * @see ConversationComputerReviewAuthority.resolve
 */
export function _CreateConversationComputerReviewRouter(options: ConversationComputerReviewRouterOptions, resolvePrincipal: ConversationComputerReviewPrincipalResolver): Router
{
	const router = Router();
	router.get("/:conversationId/review/files", function _Files(request, response) { void _Proxy(request, response, options, resolvePrincipal, "GET", ProductAuthorizationActions.Read, `/v1/files?path=${encodeURIComponent(_Query(request, "path"))}`); });
	router.get("/:conversationId/review/diff", function _Diff(request, response) { void _Proxy(request, response, options, resolvePrincipal, "GET", ProductAuthorizationActions.Read, `/v1/diff?path=${encodeURIComponent(_Query(request, "path"))}`); });
	router.get("/:conversationId/review/browser/version", function _BrowserVersion(request, response) { void _Proxy(request, response, options, resolvePrincipal, "GET", ProductAuthorizationActions.Read, "/v1/browser/version"); });
	router.get("/:conversationId/review/browser/targets", function _BrowserTargets(request, response) { void _Proxy(request, response, options, resolvePrincipal, "GET", ProductAuthorizationActions.Read, "/v1/browser/targets"); });
	router.post("/:conversationId/review/browser/pages", function _BrowserPage(request, response) { void _Proxy(request, response, options, resolvePrincipal, "POST", ProductAuthorizationActions.Use, "/v1/browser/pages", request.body); });
	router.post("/:conversationId/review/browser/screenshots", function _BrowserScreenshot(request, response) { void _Proxy(request, response, options, resolvePrincipal, "POST", ProductAuthorizationActions.Use, "/v1/browser/screenshots", request.body); });
	router.get("/:conversationId/review/previews/:port/*path", function _Preview(request, response)
	{
		const port = Number(_Parameter(request, "port"));
		if (!_PREVIEW_PORTS.has(port))
		{
			response.status(400).json({ error: "preview_port_unavailable" });
			return;
		}
		const path = _PathParameter(request, "path");
		void _Proxy(request, response, options, resolvePrincipal, "GET", ProductAuthorizationActions.Use, `/v1/previews/${port}/${path}`, undefined, true);
	});
	router.post("/:conversationId/review/commands", function _Commands(request, response) { void _Proxy(request, response, options, resolvePrincipal, "POST", ProductAuthorizationActions.Use, "/v1/commands", request.body); });
	return router;
}

/** Authorize one exact active lease, derive its Service route, and forward only the selected operation. */
async function _Proxy(request: Request, response: Response, options: ConversationComputerReviewRouterOptions, resolvePrincipal: ConversationComputerReviewPrincipalResolver, method: "GET" | "POST", action: ProductAuthorizationActions, path: string, body?: unknown, forceInertText = false): Promise<void>
{
	try
	{
		// 1. Resolve identity from the authenticated request so neither parameters nor body can select a caller.
		const principal = resolvePrincipal(request);
		if (principal === null)
		{
			response.status(401).json({ error: "unauthorized" });
			return;
		}

		// 2. Reuse conversation metadata admission, then read only server-owned computer coordinates.
		const conversationId = _Parameter(request, "conversationId");
		const caller = { principalId: principal.principalId, subjectId: principal.externalSubject, siloId: principal.siloId };
		const lease = await options.authority.resolve(caller, conversationId, action);
		if (lease === null)
		{
			response.status(404).json({ error: "conversation_computer_unavailable" });
			return;
		}
		if (!_DNS_LABEL.test(lease.sandboxId) || !_DNS_LABEL.test(options.sandboxNamespace) || !_ServiceFqdn(lease.serviceFQDN, options.sandboxNamespace))
			throw new Error("active sandbox route is invalid");

		// 3. Send the keyed review credential to the only admitted upstream host, then cap its response.
		const target = `http://${lease.serviceFQDN}:${_REVIEW_PORT}${path}`;
		const headers: Record<string, string> = { authorization: `Bearer ${lease.reviewCredential}` };
		let requestBody: string | undefined;
		if (method === "POST")
		{
			headers["content-type"] = "application/json";
			requestBody = JSON.stringify(body);
			if (Buffer.byteLength(requestBody) > 64 * 1024)
			{
				response.status(413).json({ error: "review_request_too_large" });
				return;
			}
		}
		const upstream = await ___DoWithTrace("conversation.computer_review.proxy", { conversationId, reviewAction: action, reviewMethod: method }, function _FetchReview() { return (options.fetch ?? fetch)(target, { method, headers, body: requestBody, redirect: "manual", signal: AbortSignal.timeout(35_000) }); });
		const bytes = await _ReadBoundedResponse(upstream);
		const contentType = forceInertText ? "text/plain; charset=utf-8" : upstream.headers.get("content-type") ?? "application/octet-stream";
		response.status(upstream.status).set("cache-control", "no-store").set("content-security-policy", "default-src 'none'; frame-ancestors 'none'").set("x-content-type-options", "nosniff").set("content-type", contentType).send(Buffer.from(bytes));
	}
	catch (err)
	{
		options.logger.warn({ err, conversationId: _Parameter(request, "conversationId"), reviewAction: action, reviewMethod: method }, "Conversation computer review request failed");
		response.status(503).json({ error: "conversation_computer_review_unavailable" });
	}
}

/** Require the controller-reported Service to stay inside the configured sandbox namespace. */
function _ServiceFqdn(value: string, namespace: string): boolean
{
	return value.length <= 253 && value.endsWith(`.${namespace}.svc.cluster.local`) && value.split(".").every(label => _DNS_LABEL.test(label));
}

/** Read a streamed sandbox response while cancelling as soon as it crosses the public ceiling. */
async function _ReadBoundedResponse(response: globalThis.Response): Promise<Uint8Array>
{
	const declaredLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > _MAX_RESPONSE_BYTES)
		throw new Error("sandbox review response exceeded its limit");
	if (response.body === null)
		return new Uint8Array();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	while (true)
	{
		const item = await reader.read();
		if (item.done)
			break;
		length += item.value.byteLength;
		if (length > _MAX_RESPONSE_BYTES)
		{
			await reader.cancel();
			throw new Error("sandbox review response exceeded its limit");
		}
		chunks.push(item.value);
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks)
	{
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

/** Read one non-repeated route parameter. */
function _Parameter(request: Request, name: string): string
{
	const value = request.params[name];
	return typeof value === "string" ? value : "";
}

/** Read one non-repeated query parameter. */
function _Query(request: Request, name: string): string
{
	const value = request.query[name];
	return typeof value === "string" ? value : "";
}

/** Encode a wildcard path without allowing it to create a query or fragment in the upstream URL. */
function _PathParameter(request: Request, name: string): string
{
	const value = request.params[name];
	const path = Array.isArray(value) ? value.join("/") : value ?? "";
	return path.split("/").map(segment => encodeURIComponent(segment)).join("/");
}
