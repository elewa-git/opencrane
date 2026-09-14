import { timingSafeEqual } from "node:crypto";

import { Router, type Request, type RequestHandler } from "express";
import type { Logger } from "pino";

import type { AuthenticatedPrincipalAdmission } from "@opencrane/backend/server/infra/auth";
import type { AuthenticatedPrincipalCapabilityReader } from "@opencrane/backend/server/iam/identity";

import type { PublicAuthenticationComposition } from "../app/public-app.types";
import type { DevelopmentAuthenticationTransport } from "./authentication.types";
import type { DevelopmentIdentity } from "./config.types";

const _TIER2_TRANSPORT: DevelopmentAuthenticationTransport = Object.freeze({ browserHost: "local-development.localhost:4200", directHost: "local-development.localhost:8080", proxyTargets: new Set(["127.0.0.1:8080", "localhost:8080"]), scheme: "http" });

/** Request methods that cannot change application state. */
const _SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Carries the per-launch credential set only by the dedicated Tier 2 browser or Tier 3 proxy. */
const _DEVELOPMENT_SESSION_HEADER = "x-opencrane-development-session";

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
		return `${transport.scheme}://${transport.browserHost}`;
	}
	return `${transport.scheme}://${transport.directHost}`;
}

/** Refuse state-changing requests from pages outside the exact local development origin. */
function _HasExpectedOrigin(request: Request, transport: DevelopmentAuthenticationTransport): boolean
{
	if (_SAFE_METHODS.has(request.method))
	{
		return true;
	}
	const expected = _ExpectedOrigin(request, transport);
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

/** Attach the fixed session only after exact host and origin validation. */
function _CreateSessionMiddleware(identity: DevelopmentIdentity, browserSessionCredential: string, transport: DevelopmentAuthenticationTransport): RequestHandler
{
	return function _DevelopmentSession(request, response, next): void
	{
		if (!_HasExpectedHost(request, transport))
		{
			response.status(403).json({ code: "DEVELOPMENT_HOST_MISMATCH", error: "Development requests require the dedicated local host." });
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
			response.status(403).json({ code: "DEVELOPMENT_ORIGIN_MISMATCH", error: "Development state changes require the dedicated local origin." });
			return;
		}
		const now = new Date();
		request.session = { authUser: {
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
		} } as never;
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
			const principal = await admission.admit({ siloId: identity.siloId, issuer: identity.issuer, subject: identity.subjectId });
			if (principal === null || principal.principalId !== identity.principalId || principal.siloId !== identity.siloId)
			{
				response.status(401).json({ error: "authenticated_principal_required" });
				return;
			}
			request.authenticatedPrincipal = principal;
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
function _CreateAuthRouter(identity: DevelopmentIdentity, capabilities: AuthenticatedPrincipalCapabilityReader): Router
{
	const router = Router();
	router.get("/me", async function _ReadSession(_request, response): Promise<void>
	{
		const administerOrganization = await capabilities.canAdministerOrganization({ siloId: identity.siloId, issuer: identity.issuer, subject: identity.subjectId });
		response.json({ authenticated: true, mode: "development", user: { clusterTenant: identity.siloId, email: identity.email, groups: [], isPlatformOperator: false, name: identity.displayName, productCapabilities: { administerOrganization }, sub: identity.subjectId } });
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
		router: _CreateAuthRouter(identity, capabilities),
		sessionMiddleware: [_CreateSessionMiddleware(identity, browserSessionCredential, transport)],
	};
}
