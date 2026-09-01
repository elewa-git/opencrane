import { Router, type Request, type RequestHandler } from "express";
import type { Logger } from "pino";

import { _AdmitBrowserSession, type AuthenticatedPrincipalAdmission } from "@opencrane/backend/server/infra/auth";
import type { AuthenticatedPrincipalCapabilityReader } from "@opencrane/backend/server/iam/identity";
import { LOCAL_DEVELOPMENT_PRINCIPAL_ISSUER, type LocalDevelopmentIdentity } from "@opencrane/models/local-development";

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

/** Bounds a stalled Tier 2 request to five minutes; every request rebuilds this value instead of reusing an authorization cache. */
const _DEVELOPMENT_SESSION_AUTHORIZATION_MILLISECONDS = 5 * 60 * 1000;

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
				siloId: identity.siloId,
				authorizationExpiresAt: new Date(Date.now() + _DEVELOPMENT_SESSION_AUTHORIZATION_MILLISECONDS).toISOString(),
				isPlatformOperator: false,
				email: identity.email,
				emailVerified: true,
				name: identity.displayName,
				authenticatedAt: new Date().toISOString(),
			},
		} as never;
		next();
	};
}

/** Admit the fixed development identity through the shared Principal and product-grant projection. */
function _DevelopmentProductAuthentication(identity: LocalDevelopmentIdentity, admission: AuthenticatedPrincipalAdmission, logger: Logger): RequestHandler
{
	return async function _RequireDevelopmentSession(request, response, next): Promise<void>
	{
		const authority = {
			siloId: identity.siloId,
			issuer: LOCAL_DEVELOPMENT_PRINCIPAL_ISSUER,
			subject: identity.subjectId
		};
		await _AdmitBrowserSession(request, response, next, admission, authority, "Tier 2 development session required", function _LogUnavailable(err)
		{
			logger.warn({ err, siloId: identity.siloId, subject: identity.subjectId }, "Tier 2 Principal admission is unavailable");
		});
	};
}

/** Build the small auth router consumed by the live frontend session gateway. */
function _CreateDevelopmentAuthRouter(identity: LocalDevelopmentIdentity, capabilities: AuthenticatedPrincipalCapabilityReader): Router
{
	const router = Router();
	router.get("/me", async function _ReadDevelopmentSession(_request, response): Promise<void>
	{
		const administerOrganization = await capabilities.canAdministerOrganization({
			siloId: identity.siloId,
			issuer: LOCAL_DEVELOPMENT_PRINCIPAL_ISSUER,
			subject: identity.subjectId,
		});
		response.json({
			mode: "development",
			authenticated: true,
			user: {
				sub: identity.subjectId,
				email: identity.email,
				name: identity.displayName,
				groups: [],
				isPlatformOperator: false,
				productCapabilities: { administerOrganization },
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

/**
 * Compose fixed local authentication over the same durable Principal admission used in production.
 *
 * Tier 2 still binds every request to its local host, origin, and startup identity. Before a product
 * route runs, the supplied admission task re-reads that identity and reconciles membership-derived
 * product grants. This keeps local onboarding subject to central authorization instead of granting
 * authority merely because the development middleware selected a known Principal identifier.
 *
 * Called by: the Tier 2 entrypoint in `apps/opencrane/src/development/index.ts`.
 * @param identity - Startup-selected local user and silo coordinates.
 * @param capabilities - Current product capabilities shown by the development session endpoint.
 * @param admission - Durable Principal and membership-grant projection for protected requests.
 * @param logger - Structured logger used when identity projection cannot be read.
 * @returns Authentication routes and middleware for the Tier 2 public listener.
 */
export function _CreateDevelopmentAuthentication(identity: LocalDevelopmentIdentity, capabilities: AuthenticatedPrincipalCapabilityReader, admission: AuthenticatedPrincipalAdmission, logger: Logger): PublicAuthenticationComposition
{
	const authMiddleware = _DevelopmentProductAuthentication(identity, admission, logger);

	return {
		authMiddleware,
		router: _CreateDevelopmentAuthRouter(identity, capabilities),
		sessionMiddleware: [_CreateDevelopmentSessionMiddleware(identity)],
	};
}
