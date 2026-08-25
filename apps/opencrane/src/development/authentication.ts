import { Router, type Request, type RequestHandler } from "express";

import { LOCAL_DEVELOPMENT_PRINCIPAL_ID, LOCAL_DEVELOPMENT_PRINCIPAL_ISSUER, type LocalDevelopmentIdentity } from "@opencrane/models/local-development";

import type { PublicAuthenticationComposition } from "../app/public-app.types";

/** Browser host emitted by the dedicated Angular development-live proxy. */
const _EXPECTED_FORWARDED_HOST = "local-development.localhost:4200";

/** Backend host targeted by the dedicated Angular development-live proxy. */
const _EXPECTED_PROXY_TARGET_HOSTS = new Set(["127.0.0.1:8080", "localhost:8080"]);

/** Direct backend host accepted for focused API tests and diagnostics. */
const _EXPECTED_DIRECT_HOST = "local-development.localhost:8080";

/** Browser origins allowed to mutate state through the direct and proxied Tier 2 listeners. */
const _EXPECTED_DIRECT_ORIGIN = `http://${_EXPECTED_DIRECT_HOST}`;
const _EXPECTED_FORWARDED_ORIGIN = `http://${_EXPECTED_FORWARDED_HOST}`;

/** Methods that cannot mutate Tier 2 application state. */
const _SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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

/** Return the exact browser origin selected by the already-validated host pair. */
function _ExpectedDevelopmentOrigin(request: Request): string
{
	return typeof request.headers["x-forwarded-host"] === "string"
		? _EXPECTED_FORWARDED_ORIGIN
		: _EXPECTED_DIRECT_ORIGIN;
}

/** Refuse browser state changes sent by a page outside the dedicated Tier 2 origin. */
function _HasExpectedDevelopmentOrigin(request: Request): boolean
{
	if (_SAFE_METHODS.has(request.method))
	{
		return true;
	}

	const expected = _ExpectedDevelopmentOrigin(request);
	const origin = request.get("origin");

	if (origin)
	{
		return origin === expected;
	}

	const referer = request.get("referer");

	if (!referer)
	{
		return false;
	}

	try
	{
		return new URL(referer).origin === expected;
	}
	catch
	{
		return false;
	}
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

		if (!_HasExpectedDevelopmentOrigin(request))
		{
			response.status(403).json({
				error: "Tier 2 state changes require the dedicated local development origin.",
				code: "DEVELOPMENT_ORIGIN_MISMATCH",
			});
			return;
		}

		request.session = {
			authUser: {
				sub: identity.subjectId,
				issuer: LOCAL_DEVELOPMENT_PRINCIPAL_ISSUER,
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
function _DevelopmentProductAuthentication(identity: LocalDevelopmentIdentity): RequestHandler
{
	return function _RequireDevelopmentSession(request, response, next): void
	{
		if (!request.session?.authUser)
		{
			response.status(401).json({ error: "Tier 2 development session required" });
			return;
		}

		request.authenticatedPrincipal = {
			principalId: LOCAL_DEVELOPMENT_PRINCIPAL_ID,
			siloId: identity.siloId,
			issuer: LOCAL_DEVELOPMENT_PRINCIPAL_ISSUER,
			subject: identity.subjectId
		};
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
	const authMiddleware = _DevelopmentProductAuthentication(identity);

	return {
		authMiddleware,
		productAuthentication: authMiddleware,
		router: _CreateDevelopmentAuthRouter(identity),
		sessionMiddleware: [_CreateDevelopmentSessionMiddleware(identity)],
	};
}
