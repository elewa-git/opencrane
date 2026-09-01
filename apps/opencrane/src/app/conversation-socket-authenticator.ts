import { ServerResponse, type IncomingMessage } from "node:http";

import type { RequestHandler } from "express";
import type { Request, Response } from "express";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import type { SelfConversationSocketAuthenticator } from "@opencrane/backend/server/conversations";

/**
 * Builds the app-owned authentication seam for a conversation WebSocket upgrade.
 *
 * A WebSocket upgrade bypasses Express routing, so it must run the same session middleware that
 * populated an HTTP request before resolving the principal. It refuses a non-same-origin upgrade
 * before doing that work; otherwise a site that can cause a browser to send its cookie could open a
 * participant socket. `null` tells the socket server to destroy the upgrade without taking over its
 * TCP connection.
 *
 * Called by: `_Main` in `apps/opencrane/src/index.ts` while composing the public listener.
 *
 * @param sessionMiddleware - The public app's session middleware. Its first handler restores the
 *   signed-in browser session onto the upgrade request.
 * @param authMiddleware - The same product authentication boundary used by public HTTP routes.
 * @returns An authenticator that supplies trusted silo and subject coordinates, or `null` for a
 *   rejected upgrade.
 */
export function _CreateConversationSocketAuthenticator(sessionMiddleware: readonly RequestHandler[], authMiddleware: RequestHandler): SelfConversationSocketAuthenticator
{
	const session = sessionMiddleware[0];
	if (session === undefined)
		throw new Error("conversation socket authentication requires session middleware");
	return {
		authenticate: async function _Authenticate(request: IncomingMessage)
		{
			if (!__IsSameOriginConversationSocketRequest(request))
				return null;
			await _RunSession(session, request);
			const expressRequest = _AsExpressRequest(request);
			if (!await _RunAuthentication(authMiddleware, expressRequest))
				return null;
			const principal = _ResolveRequestPrincipal(expressRequest);
			return principal === null ? null : { siloId: principal.siloId, principalId: principal.principalId, issuer: principal.externalIssuer, subjectId: principal.externalSubject };
		}
	};
}

/** Adds Express's header accessor without copying the restored session onto a second request. */
function _AsExpressRequest(request: IncomingMessage): Request
{
	return Object.assign(Object.create(request), {
		path: new URL(request.url ?? "/", "http://localhost").pathname,
		get(name: string): string | undefined { return name.toLowerCase() === "host" ? request.headers.host : undefined; }
	}) as Request;
}

/**
 * Checks whether a WebSocket upgrade came from the same public origin as the cookie session.
 *
 * Ingress terminates TLS before this process, so the policy uses its forwarded public host and
 * protocol when present rather than the internal listener address. A false result is a refusal,
 * not an alternate origin policy: the socket authenticator must not restore a session for it.
 *
 * Called by: {@link _CreateConversationSocketAuthenticator} before it runs session middleware.
 *
 * @param request - The raw HTTP upgrade request, including ingress forwarding headers.
 * @returns `true` only when `Origin` exactly equals the public HTTP or HTTPS origin.
 */
export function __IsSameOriginConversationSocketRequest(request: IncomingMessage): boolean
{
	const origin = request.headers.origin;
	const forwardedHost = request.headers["x-forwarded-host"];
	const host = typeof forwardedHost === "string" ? forwardedHost.split(",")[0]?.trim() : request.headers.host;
	const forwardedProtocol = request.headers["x-forwarded-proto"];
	const forwarded = typeof forwardedProtocol === "string" ? forwardedProtocol.split(",")[0]?.trim() : undefined;
	const isEncrypted = "encrypted" in request.socket && request.socket.encrypted === true;
	const protocol = forwarded ?? (isEncrypted ? "https" : "http");
	if (typeof origin !== "string" || host === undefined || (protocol !== "http" && protocol !== "https"))
		return false;
	try { return new URL(origin).origin === `${protocol}://${host}`; }
	catch { return false; }
}

/** Runs the read-only session handler against an upgrade request without sending an HTTP response. */
function _RunSession(session: RequestHandler, request: IncomingMessage): Promise<void>
{
	return new Promise<void>(function _Run(resolve, reject)
	{
		const response = new ServerResponse(request);
		session(request as never, response as never, function _Next(error?: unknown)
		{
			if (error === undefined)
				resolve();
			else
				reject(error);
		});
	});
}

/** Run product authentication and report whether it admitted the upgrade request. */
function _RunAuthentication(authenticate: RequestHandler, request: Request): Promise<boolean>
{
	return new Promise<boolean>(function _Run(resolve, reject)
	{
		const response = {
			status(): Response { return response as unknown as Response; },
			json(): Response { resolve(false); return response as unknown as Response; },
		} as unknown as Response;
		authenticate(request, response, function _Next(error?: unknown)
		{
			if (error === undefined)
				resolve(true);
			else
				reject(error);
		});
	});
}
