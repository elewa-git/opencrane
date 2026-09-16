import { timingSafeEqual } from "node:crypto";

import { Router, type Request, type RequestHandler, type Response } from "express";
import type { Logger } from "pino";

import type { AuthenticatedPrincipalAdmission } from "@opencrane/backend/server/infra/auth";
import type { AuthenticatedPrincipalCapabilityReader } from "@opencrane/backend/server/iam/identity";

import type { PublicAuthenticationComposition } from "../app/public-app.types";
import type { DevelopmentIdentity } from "./config.types";

/** Direct API hostname allowed for focused diagnostics. */
const _EXPECTED_DIRECT_HOST = "local-development.localhost:8080";

/** Loopback proxy targets allowed to carry the dedicated browser host. */
const _EXPECTED_PROXY_TARGETS = new Set(["127.0.0.1:8080", "localhost:8080"]);

/** Request methods that cannot change application state. */
const _SAFE_METHODS = new Set([
	"GET",
	"HEAD",
	"OPTIONS",
]);

/** Carries the per-launch credential set only by the dedicated Tier 2 browser. */
const _DEVELOPMENT_SESSION_HEADER = "x-opencrane-development-session";

/** Development-only route that converts a verified browser click into the private landing URL. */
const _DEVELOPMENT_SESSION_HANDOFF_PATH = "/api/v1/auth/development-session";

/** Short authorization lifetime forces every long-running local session to be re-projected. */
const _AUTHORIZATION_LIFETIME_MILLISECONDS = 5 * 60 * 1_000;

/** Return true only for the direct development host or its exact Angular proxy pair. */
function _HasExpectedHost(request: Request, browserHost: string): boolean
{
	const host = request.get("host")?.trim().toLowerCase() ?? "";
	const forwardedHost = request.headers["x-forwarded-host"];

	if (typeof forwardedHost === "string")
	{
		return forwardedHost.trim().toLowerCase() === browserHost && _EXPECTED_PROXY_TARGETS.has(host);
	}

	return host === _EXPECTED_DIRECT_HOST;
}

/** Resolve the browser origin after the host pair has already been checked. */
function _ExpectedOrigin(request: Request, browserOrigin: string): string
{
	if (typeof request.headers["x-forwarded-host"] === "string")
	{
		return browserOrigin;
	}
	return `http://${_EXPECTED_DIRECT_HOST}`;
}

/** Refuse state-changing requests from pages outside the exact local development origin. */
function _HasExpectedOrigin(request: Request, browserOrigin: string): boolean
{
	if (_SAFE_METHODS.has(request.method))
	{
		return true;
	}
	const expected = _ExpectedOrigin(request, browserOrigin);
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

/** Checks whether the configured Tier 2 browser origin started a user-activated top-level navigation. */
function _HasExpectedHandoffNavigation(request: Request, browserOrigin: string): boolean
{
	if (
		request.method !== "GET"
		|| typeof request.headers["x-forwarded-host"] !== "string"
		|| request.get("sec-fetch-site") !== "same-origin"
		|| request.get("sec-fetch-mode") !== "navigate"
		|| request.get("sec-fetch-dest") !== "document"
		|| request.get("sec-fetch-user") !== "?1"
	)
	{
		return false;
	}

	const referer = request.get("referer");

	if (!referer)
		return false;

	try
	{
		return new URL(referer).origin === browserOrigin;
	}
	catch
	{
		return false;
	}
}

/** Checks the configured host before forwarding a handoff or attaching the fixed development session. */
function _CreateSessionMiddleware(identity: DevelopmentIdentity, browserSessionCredential: string, browserOrigin: string): RequestHandler
{
	const browserHost = new URL(browserOrigin).host;

	return function _DevelopmentSession(request, response, next): void
	{
		if (!_HasExpectedHost(request, browserHost))
		{
			response.status(403).json({
				code: "DEVELOPMENT_HOST_MISMATCH",
				error: "Tier 2 requests require the dedicated local development host.",
			});
			return;
		}

		if (request.path === _DEVELOPMENT_SESSION_HANDOFF_PATH)
		{
			if (!_HasExpectedHandoffNavigation(request, browserOrigin))
			{
				response.status(403).json({
					code: "DEVELOPMENT_SESSION_HANDOFF_REFUSED",
					error: "Tier 2 session handoff requires a same-origin browser action.",
				});
				return;
			}

			next();
			return;
		}

		const suppliedCredential = request.get(_DEVELOPMENT_SESSION_HEADER) ?? "";
		const expected = Buffer.from(browserSessionCredential, "utf8");
		const supplied = Buffer.from(suppliedCredential, "utf8");
		if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected))
		{
			response.status(401).json({
				code: "DEVELOPMENT_SESSION_REQUIRED",
				error: "Tier 2 requests require the private per-launch browser session.",
			});
			return;
		}

		if (!_HasExpectedOrigin(request, browserOrigin))
		{
			response.status(403).json({
				code: "DEVELOPMENT_ORIGIN_MISMATCH",
				error: "Tier 2 state changes require the dedicated local development origin.",
			});
			return;
		}
		const now = new Date();
		request.session = {
			authUser: {
				authenticatedAt: now.toISOString(),
				authorizationExpiresAt: new Date(now.getTime() + _AUTHORIZATION_LIFETIME_MILLISECONDS).toISOString(),
				email: identity.email,
				emailVerified: true,
				groups: [],
				isPlatformOperator: false,
				issuer: identity.issuer,
				name: identity.displayName,
				siloId: identity.siloId,
				sub: identity.subjectId,
			},
		} as never;
		next();
	};
}

/** Re-read the durable Principal and membership-managed grants for every protected request. */
function _CreateAdmissionMiddleware(identity: DevelopmentIdentity, admission: AuthenticatedPrincipalAdmission, logger: Logger): RequestHandler
{
	return async function _AdmitDevelopmentPrincipal(request, response, next): Promise<void>
	{
		if (request.path === "/healthz" || request.path.startsWith("/api/v1/auth"))
		{
			next();
			return;
		}
		try
		{
			const principal = await admission.admit({
				siloId: identity.siloId,
				issuer: identity.issuer,
				subject: identity.subjectId,
			});

			if (
				!principal
				|| principal.principalId !== identity.principalId
				|| principal.siloId !== identity.siloId
			)
			{
				response.status(401).json({ error: "authenticated_principal_required" });
				return;
			}
			request.authenticatedPrincipal = principal;
			next();
		}
		catch (err)
		{
			logger.warn({
				err,
				siloId: identity.siloId,
				subject: identity.subjectId,
			}, "Tier 2 Principal admission is unavailable");
			response.status(503).json({ error: "identity_projection_unavailable" });
		}
	};
}

/** Build the development session endpoint used by the live frontend. */
function _CreateAuthRouter(identity: DevelopmentIdentity, capabilities: AuthenticatedPrincipalCapabilityReader, browserSessionCredential: string, browserOrigin: string): Router
{
	const router = Router();
	/** Redirect a verified same-origin click without serializing the credential into a response body. */
	function _CompleteDevelopmentSessionHandoff(_request: Request, response: Response): void
	{
		const landingUrl = new URL(browserOrigin);
		const fragment = new URLSearchParams({ "development-session": browserSessionCredential });
		landingUrl.hash = fragment.toString();
		const headers = {
			"Cache-Control": "no-store",
			"Location": landingUrl.toString(),
			"Pragma": "no-cache",
			"Referrer-Policy": "no-referrer",
		};
		response
			.status(303)
			.set(headers)
			.end();
	}

	router.get("/development-session", _CompleteDevelopmentSessionHandoff);
	router.get("/me", async function _ReadSession(_request, response): Promise<void>
	{
		const administerOrganization = await capabilities.canAdministerOrganization({
			siloId: identity.siloId,
			issuer: identity.issuer,
			subject: identity.subjectId,
		});
		response.json({
			authenticated: true,
			mode: "development",
			user: {
				clusterTenant: identity.siloId,
				email: identity.email,
				groups: [],
				isPlatformOperator: false,
				name: identity.displayName,
				productCapabilities: { administerOrganization },
				sub: identity.subjectId,
			},
		});
	});
	router.post("/logout", function _KeepFixedSession(_request, response): void
	{
		response.status(204).end();
	});

	return router;
}

/**
 * Compose a development-only browser identity over production Principal admission.
 *
 * Called by: the Tier 2 development entrypoint for its loopback-only public listener.
 */
export function _CreateDevelopmentAuthentication(identity: DevelopmentIdentity, capabilities: AuthenticatedPrincipalCapabilityReader, admission: AuthenticatedPrincipalAdmission, browserSessionCredential: string, logger: Logger, browserOrigin = "http://local-development.localhost:4200"): PublicAuthenticationComposition
{
	return {
		authMiddleware: _CreateAdmissionMiddleware(identity, admission, logger),
		router: _CreateAuthRouter(identity, capabilities, browserSessionCredential, browserOrigin),
		sessionMiddleware: [_CreateSessionMiddleware(identity, browserSessionCredential, browserOrigin)],
	};
}
