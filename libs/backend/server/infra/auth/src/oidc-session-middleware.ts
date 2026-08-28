import { URL } from "node:url";

import type { RequestHandler } from "express";
import session from "express-session";

import type { BrowserSessionConfig } from "./browser-session.types";
import type { OidcAuthConfig } from "./oidc-config.types";

/**
 * Creates the session and CSRF middleware for one OIDC deployment.
 *
 * With OIDC disabled, the returned handler does not create a cookie session. With OIDC enabled,
 * the session cookie is HTTP-only and `SameSite=Lax`, then a second handler checks same-origin
 * state-changing browser requests that carry authenticated session state.
 *
 * Called by: {@link OidcAuthServiceBase.createSessionMiddleware} during Express composition.
 * @param config - The deployment's OIDC and session-cookie settings.
 * @returns A pass-through handler when disabled, otherwise the session and CSRF handlers.
 */
export function ___CreateOidcSessionMiddleware(config: OidcAuthConfig): RequestHandler[]
{
	if (!config.enabled) return [function _skipSession(_request, _response, next) { next(); }];
	return ___CreateBrowserSessionMiddleware(config);
}

/**
 * Creates a signed browser session and its same-origin mutation guard.
 *
 * Called by: OIDC and explicitly selected development authentication compositions.
 * @param config - Startup-selected cookie name, lifetime, transport policy, and signing secret.
 * @returns The session restoration handler followed by the authenticated CSRF guard.
 */
export function ___CreateBrowserSessionMiddleware(config: BrowserSessionConfig): RequestHandler[]
{
	return [
		session({
			name: config.cookieName,
			secret: config.sessionSecret,
			resave: false,
			saveUninitialized: false,
			proxy: true,
			unset: "destroy",
			cookie: { httpOnly: true, sameSite: "lax", secure: config.cookieSecure, maxAge: config.sessionMaxAgeMs },
		}),
		_CsrfOriginCheck(),
	];
}

/**
 * Rejects an authenticated state-changing browser request whose Origin or Referer is another host.
 *
 * Read requests and requests without authenticated session state pass through. Checking the origin
 * only when the browser can send a session cookie prevents another site from acting as that user.
 * @returns Middleware that responds with a specific 403 code when the origin check fails.
 */
function _CsrfOriginCheck(): RequestHandler
{
	const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
	return function _csrfCheck(request, response, next)
	{
		if (safeMethods.has(request.method) || !request.session?.authUser) return void next();
		const expected = `${request.protocol}://${request.hostname}`;
		const origin = request.headers.origin;
		const referer = request.headers.referer;
		if (origin !== undefined)
		{
			if (origin !== expected) response.status(403).json({ error: "CSRF check failed.", code: "CSRF_ORIGIN_MISMATCH" });
			else next();
			return;
		}
		if (referer !== undefined)
		{
			let refererOrigin: string;
			try { refererOrigin = new URL(referer).origin; }
			catch
			{
				response.status(403).json({ error: "CSRF check failed.", code: "CSRF_INVALID_REFERER" });
				return;
			}
			if (refererOrigin !== expected)
			{
				response.status(403).json({ error: "CSRF check failed.", code: "CSRF_REFERER_MISMATCH" });
				return;
			}
		}
		next();
	};
}
