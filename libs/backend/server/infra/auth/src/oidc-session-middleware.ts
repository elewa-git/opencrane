import { URL } from "node:url";

import type { RequestHandler } from "express";
import session from "express-session";

import type { OidcAuthConfig } from "./oidc-config.types";

/** Builds cookie-session and same-origin CSRF middleware for one OIDC deployment. */
export function ___CreateOidcSessionMiddleware(config: OidcAuthConfig): RequestHandler[]
{
	if (!config.enabled) return [function _skipSession(_request, _response, next) { next(); }];
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

/** Rejects state-changing browser requests whose Origin or Referer names another host. */
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
