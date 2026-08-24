import { Router, type Request, type RequestHandler } from "express";

import type { LocalDevelopmentIdentity } from "@opencrane/models/local-development";

import type { PublicAuthenticationComposition } from "../app/public-app.types";

/** Browser host emitted by the dedicated Angular development-live proxy. */
const _EXPECTED_FORWARDED_HOST = "local-development.localhost:4200";

/** Backend host targeted by the dedicated Angular development-live proxy. */
const _EXPECTED_PROXY_TARGET_HOSTS = new Set(["127.0.0.1:8080", "localhost:8080"]);

/** Direct backend host accepted for focused API tests and diagnostics. */
const _EXPECTED_DIRECT_HOST = "local-development.localhost:8080";

/** Return true only for the direct local hostname or the exact dedicated UI proxy pair. */
function _HasExpectedDevelopmentHost(request: Request): boolean
{
	const host = request.get("host")?.trim().toLowerCase();
	const forwarded = request.headers["x-forwarded-host"];

	if (typeof forwarded === "string")
	{
		return forwarded.trim().toLowerCase() === _EXPECTED_FORWARDED_HOST && !!host && _EXPECTED_PROXY_TARGET_HOSTS.has(host);
	}

	return host === _EXPECTED_DIRECT_HOST;
}

/** Attach the installation-selected development identity after the exact host pair is verified. */
function _CreateDevelopmentSessionMiddleware(identity: LocalDevelopmentIdentity): RequestHandler
{
	return function _DevelopmentSession(request, response, next): void
	{
		if (!_HasExpectedDevelopmentHost(request))
		{
			response.status(403).json({
				error: "Tier 2 requests require the dedicated local development host.",
				code: "DEVELOPMENT_HOST_MISMATCH",
			});
			return;
		}

		request.session = {
			authUser: {
				sub: identity.subjectId,
				issuer: "opencrane-local-development",
				groups: [],
				isPlatformOperator: false,
				isOrgAdmin: true,
				email: identity.email,
				emailVerified: true,
				name: identity.displayName,
				authenticatedAt: new Date().toISOString(),
			},
		} as never;
		next();
	};
}

/** Require the fixed development session before any product route can execute. */
function _DevelopmentProductAuthentication(): RequestHandler
{
	return function _RequireDevelopmentSession(request, response, next): void
	{
		if (!request.session?.authUser)
		{
			response.status(401).json({ error: "Tier 2 development session required" });
			return;
		}

		next();
	};
}

/** Build the small auth router consumed by the live frontend session gateway. */
function _CreateDevelopmentAuthRouter(identity: LocalDevelopmentIdentity): Router
{
	const router = Router();
	router.get("/me", function _ReadDevelopmentSession(_request, response): void
	{
		response.json({
			mode: "development",
			authenticated: true,
			user: {
				sub: identity.subjectId,
				email: identity.email,
				name: identity.displayName,
				groups: [],
				isPlatformOperator: false,
				isOrgAdmin: true,
				clusterTenant: identity.siloId,
			},
		});
	});
	router.post("/logout", function _KeepDevelopmentSession(_request, response): void
	{
		response.status(204).end();
	});
	return router;
}

/** Compose fixed local authentication without importing it from the production entrypoint. */
export function _CreateDevelopmentAuthentication(identity: LocalDevelopmentIdentity): PublicAuthenticationComposition
{
	return {
		productAuthentication: _DevelopmentProductAuthentication(),
		router: _CreateDevelopmentAuthRouter(identity),
		sessionMiddleware: [_CreateDevelopmentSessionMiddleware(identity)],
	};
}
