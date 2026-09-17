import { timingSafeEqual } from "node:crypto";

import { Router, type Request, type RequestHandler, type Response } from "express";
import type { Logger } from "pino";

import { _BindRequestPrincipalSilo, type AuthenticatedPrincipalAdmission } from "@opencrane/backend/server/infra/auth";
import type { AuthenticatedPrincipalCapabilityReader } from "@opencrane/backend/server/iam/identity";

import type { PublicAuthenticationComposition } from "../app/public-app.types";
import type { DevelopmentAuthenticationTransport } from "./authentication.types";
import type { DevelopmentIdentity } from "./config.types";

const _TIER2_TRANSPORT: DevelopmentAuthenticationTransport = Object.freeze({ browserHost: "local-development.localhost:4200", directHost: "local-development.localhost:8080", proxyTargets: new Set(["127.0.0.1:8080", "localhost:8080"]), scheme: "http" });

/** Origin observed after Codespaces forwards the external Tier 2 browser request to its loopback target. */
const _CODESPACES_REWRITTEN_ORIGIN = "https://localhost:4200";

/** Request methods that cannot change application state. */
const _SAFE_METHODS = new Set([
	"GET",
	"HEAD",
	"OPTIONS",
]);

/** Carries the per-launch credential set only by the dedicated Tier 2 browser or Tier 3 proxy. */
const _DEVELOPMENT_SESSION_HEADER = "x-opencrane-development-session";

/** Development-only route that converts a verified browser click into the private landing URL. */
const _DEVELOPMENT_SESSION_HANDOFF_PATH = "/api/v1/auth/development-session";

/** Short authorization lifetime forces every long-running local session to be re-projected. */
const _AUTHORIZATION_LIFETIME_MILLISECONDS = 5 * 60 * 1_000;

/** Return true only for the direct development host or its exact Angular proxy pair. */
function _HasExpectedHost(request: Request, transport: DevelopmentAuthenticationTransport): boolean
{
	const host = request.get("host")?.trim().toLowerCase() ?? "";
	const forwardedHost = request.headers["x-forwarded-host"];

	if (typeof forwardedHost === "string")
	{
		return forwardedHost.trim().toLowerCase() === transport.browserHost && transport.proxyTargets.has(host);
	}
	return host === transport.directHost;
}

/** Resolve the browser origin after the host pair has already been checked. */
function _ExpectedOrigin(request: Request, transport: DevelopmentAuthenticationTransport): string
{
	if (typeof request.headers["x-forwarded-host"] === "string")
	{
		return _BrowserOrigin(transport);
	}
	return `${transport.scheme}://${transport.directHost}`;
}

/** Resolve the configured browser origin without consulting request-controlled headers. */
function _BrowserOrigin(transport: DevelopmentAuthenticationTransport): string
{
	return `${transport.browserScheme ?? transport.scheme}://${transport.browserHost}`;
}

/** Returns whether an absolute URL has the expected normalized origin; malformed values do not match. */
function _MatchesExpectedOrigin(value: string, expected: string): boolean
{
	try
	{
		return new URL(value).origin === expected;
	}
	catch
	{
		return false;
	}
}

/**
 * Reduces a received URL to its origin so mismatch logs omit path and query data.
 * Missing values remain `undefined`, while malformed values become `null`.
 */
function _ReportedOrigin(value: string | undefined): string | null | undefined
{
	if (value === undefined)
		return;

	try
	{
		return new URL(value).origin;
	}
	catch
	{
		return null;
	}
}

/**
 * Accepts the Codespaces loopback `Origin` only on a forwarded HTTPS browser request whose
 * `Referer` matches the expected external origin and whose `Sec-Fetch-Site` reports `same-origin`.
 */
function _HasExpectedCodespacesOriginRewrite(request: Request, origin: string, expected: string, transport: DevelopmentAuthenticationTransport): boolean
{
	const referer = request.get("referer");

	return (
		typeof request.headers["x-forwarded-host"] === "string"
		&& transport.browserScheme === "https"
		&& transport.scheme === "http"
		&& expected.startsWith("https://")
		&& _MatchesExpectedOrigin(origin, _CODESPACES_REWRITTEN_ORIGIN)
		&& referer !== undefined
		&& _MatchesExpectedOrigin(referer, expected)
		&& request.get("sec-fetch-site") === "same-origin"
	);
}

/**
 * Accepts safe methods without origin evidence and checks `Origin` before `Referer` for state changes.
 * A Codespaces loopback `Origin` must also satisfy {@link _HasExpectedCodespacesOriginRewrite}.
 * If both URL headers are absent, a proxied request may use `Sec-Fetch-Site: same-origin`.
 * Both exceptions rely on the caller first verifying the exact external `X-Forwarded-Host`,
 * internal loopback host, and private per-launch credential; every other present but invalid
 * URL header fails closed.
 */
function _HasExpectedOrigin(request: Request, transport: DevelopmentAuthenticationTransport): boolean
{
	if (_SAFE_METHODS.has(request.method))
	{
		return true;
	}
	const expected = _ExpectedOrigin(request, transport);
	const origin = request.get("origin");

	if (origin !== undefined)
	{
		if (_MatchesExpectedOrigin(origin, expected))
			return true;

		return _HasExpectedCodespacesOriginRewrite(request, origin, expected, transport);
	}
	const referer = request.get("referer");

	if (referer !== undefined)
	{
		return _MatchesExpectedOrigin(referer, expected);
	}

	return typeof request.headers["x-forwarded-host"] === "string" && request.get("sec-fetch-site") === "same-origin";
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
function _CreateSessionMiddleware(identity: DevelopmentIdentity, browserSessionCredential: string, transport: DevelopmentAuthenticationTransport, logger: Logger): RequestHandler
{
	return function _DevelopmentSession(request, response, next): void
	{
		if (!_HasExpectedHost(request, transport))
		{
			response.status(403).json({ code: "DEVELOPMENT_HOST_MISMATCH", error: "Development requests require the dedicated local host." });
			return;
		}

		if (request.path === _DEVELOPMENT_SESSION_HANDOFF_PATH)
		{
			const browserOrigin = _BrowserOrigin(transport);

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
			response.status(401).json({ code: "DEVELOPMENT_SESSION_REQUIRED", error: "Development requests require the private per-launch browser session." });
			return;
		}
		if (!_HasExpectedOrigin(request, transport))
		{
			const browserOrigin = _BrowserOrigin(transport);
			logger.warn({
				browserOrigin,
				forwardedHost: request.headers["x-forwarded-host"],
				host: request.get("host"),
				method: request.method,
				origin: _ReportedOrigin(request.get("origin")),
				path: request.path,
				refererOrigin: _ReportedOrigin(request.get("referer")),
				secFetchSite: request.get("sec-fetch-site"),
			}, "Development state change origin did not match the configured browser");
			response.status(403).json({ code: "DEVELOPMENT_ORIGIN_MISMATCH", error: "Development state changes require the dedicated local origin." });
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
			_BindRequestPrincipalSilo(request, identity.siloId);
			next();
		}
		catch (err)
		{
			logger.warn({ err, siloId: identity.siloId, subject: identity.subjectId }, "Development Principal admission is unavailable");
			response.status(503).json({ error: "identity_projection_unavailable" });
		}
	};
}

/** Build the development session endpoint used by the live frontend. */
function _CreateAuthRouter(identity: DevelopmentIdentity, capabilities: AuthenticatedPrincipalCapabilityReader, browserSessionCredential: string, transport: DevelopmentAuthenticationTransport): Router
{
	const router = Router();
	const browserOrigin = `${transport.browserScheme ?? transport.scheme}://${transport.browserHost}`;
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
 * The caller supplies the accepted direct/proxy hosts and scheme; state-changing requests from any
 * other origin fail before the fixed session is attached. Protected routes then re-read the durable
 * Principal and current membership-managed capability instead of trusting the browser credential.
 * Called by: the Tier 2 entrypoint and the explicitly selected Tier 3 k3d composition.
 * @returns Session, authentication, and `/api/v1/auth` middleware for the public application.
 */
export function _CreateDevelopmentAuthentication(identity: DevelopmentIdentity, capabilities: AuthenticatedPrincipalCapabilityReader, admission: AuthenticatedPrincipalAdmission, browserSessionCredential: string, logger: Logger, transport: DevelopmentAuthenticationTransport = _TIER2_TRANSPORT): PublicAuthenticationComposition
{
	return {
		authMiddleware: _CreateAdmissionMiddleware(identity, admission, logger),
		router: _CreateAuthRouter(identity, capabilities, browserSessionCredential, transport),
		sessionMiddleware: [_CreateSessionMiddleware(identity, browserSessionCredential, transport, logger)],
	};
}
