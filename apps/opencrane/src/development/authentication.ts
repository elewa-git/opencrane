import { timingSafeEqual } from "node:crypto";

import { Router, type Request, type RequestHandler } from "express";
import type { Logger } from "pino";

import type { AuthenticatedPrincipalAdmission } from "@opencrane/backend/server/infra/auth";
import type { AuthenticatedPrincipalCapabilityReader } from "@opencrane/backend/server/iam/identity";

import type { PublicAuthenticationComposition } from "../app/public-app.types";
import type { DevelopmentIdentity } from "./config.types";

/** Browser hostname emitted by the dedicated Angular Tier 2 server. */
const _EXPECTED_BROWSER_HOST = "local-development.localhost:4200";

/** Direct API hostname allowed for focused diagnostics. */
const _EXPECTED_DIRECT_HOST = "local-development.localhost:8080";

/** Loopback proxy targets allowed to carry the dedicated browser host. */
const _EXPECTED_PROXY_TARGETS = new Set(["127.0.0.1:8080", "localhost:8080"]);

/** Request methods that cannot change application state. */
const _SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Carries the per-launch credential set only by the dedicated Tier 2 browser. */
const _DEVELOPMENT_SESSION_HEADER = "x-opencrane-development-session";

/** Short authorization lifetime forces every long-running local session to be re-projected. */
const _AUTHORIZATION_LIFETIME_MILLISECONDS = 5 * 60 * 1_000;

/** Return true only for the direct development host or its exact Angular proxy pair. */
function _HasExpectedHost(request: Request): boolean
{
	const host = request.get("host")?.trim().toLowerCase() ?? "";
	const forwardedHost = request.headers["x-forwarded-host"];
	if (typeof forwardedHost === "string")
	{
		return forwardedHost.trim().toLowerCase() === _EXPECTED_BROWSER_HOST && _EXPECTED_PROXY_TARGETS.has(host);
	}
	return host === _EXPECTED_DIRECT_HOST;
}

/** Resolve the browser origin after the host pair has already been checked. */
function _ExpectedOrigin(request: Request): string
{
	if (typeof request.headers["x-forwarded-host"] === "string")
	{
		return `http://${_EXPECTED_BROWSER_HOST}`;
	}
	return `http://${_EXPECTED_DIRECT_HOST}`;
}

/** Refuse state-changing requests from pages outside the exact local development origin. */
function _HasExpectedOrigin(request: Request): boolean
{
	if (_SAFE_METHODS.has(request.method))
	{
		return true;
	}
	const expected = _ExpectedOrigin(request);
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
function _CreateSessionMiddleware(identity: DevelopmentIdentity, browserSessionCredential: string): RequestHandler
{
	return function _DevelopmentSession(request, response, next): void
	{
		if (!_HasExpectedHost(request))
		{
			response.status(403).json({ code: "DEVELOPMENT_HOST_MISMATCH", error: "Tier 2 requests require the dedicated local development host." });
			return;
		}
		const suppliedCredential = request.get(_DEVELOPMENT_SESSION_HEADER) ?? "";
		const expected = Buffer.from(browserSessionCredential, "utf8");
		const supplied = Buffer.from(suppliedCredential, "utf8");
		if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected))
		{
			response.status(401).json({ code: "DEVELOPMENT_SESSION_REQUIRED", error: "Tier 2 requests require the private per-launch browser session." });
			return;
		}
		if (!_HasExpectedOrigin(request))
		{
			response.status(403).json({ code: "DEVELOPMENT_ORIGIN_MISMATCH", error: "Tier 2 state changes require the dedicated local development origin." });
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
			logger.warn({ err, siloId: identity.siloId, subject: identity.subjectId }, "Tier 2 Principal admission is unavailable");
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
 * Called by: the Tier 2 development entrypoint for its loopback-only public listener.
 */
export function _CreateDevelopmentAuthentication(identity: DevelopmentIdentity, capabilities: AuthenticatedPrincipalCapabilityReader, admission: AuthenticatedPrincipalAdmission, browserSessionCredential: string, logger: Logger): PublicAuthenticationComposition
{
	return {
		authMiddleware: _CreateAdmissionMiddleware(identity, admission, logger),
		router: _CreateAuthRouter(identity, capabilities),
		sessionMiddleware: [_CreateSessionMiddleware(identity, browserSessionCredential)],
	};
}
