import type { Request } from "express";

import { _HasSameOriginBrowserEvidence, type SameOriginBrowserRequestAuthority } from "@opencrane/backend/server/infra/auth";

import type { DevelopmentAuthenticationTransport } from "./authentication.types";

/** Direct Tier 2 API hostname allowed for focused diagnostics. */
const _TIER2_DIRECT_HOST = "local-development.localhost:8080";

/** Loopback proxy targets allowed to carry the dedicated Tier 2 browser host. */
const _TIER2_PROXY_TARGETS = new Set(["127.0.0.1:8080", "localhost:8080"]);

/** Origin observed after Codespaces forwards the external Tier 2 browser request to its loopback target. */
const _CODESPACES_REWRITTEN_ORIGIN = "https://localhost:4200";

/** Converts the coordinator-validated Tier 2 browser origin into the complete transport tuple. */
export function _CreateTier2DevelopmentAuthenticationTransport(browserOrigin: string): DevelopmentAuthenticationTransport
{
	const browser = new URL(browserOrigin);
	const browserScheme = browser.protocol === "https:" ? "https" : "http";

	return Object.freeze({
		browserHost: browser.host,
		browserScheme,
		directHost: _TIER2_DIRECT_HOST,
		proxyTargets: _TIER2_PROXY_TARGETS,
		scheme: "http",
	});
}

/** Resolves the configured browser origin without consulting request-controlled headers. */
export function _DevelopmentBrowserOrigin(transport: DevelopmentAuthenticationTransport): string
{
	return `${transport.browserScheme ?? transport.scheme}://${transport.browserHost}`;
}

/** Returns true only for the selected direct host or exact browser-host and proxy-target pair. */
export function _HasExpectedDevelopmentHost(request: Request, transport: DevelopmentAuthenticationTransport): boolean
{
	const host = request.get("host")?.trim().toLowerCase() ?? "";
	const forwardedHost = request.headers["x-forwarded-host"];

	if (typeof forwardedHost === "string")
		return forwardedHost.trim().toLowerCase() === transport.browserHost && transport.proxyTargets.has(host);

	return host === transport.directHost;
}

/** Resolves the expected browser origin after the complete host tuple has been accepted. */
function _ExpectedOrigin(request: Request, transport: DevelopmentAuthenticationTransport): string
{
	if (typeof request.headers["x-forwarded-host"] === "string")
		return _DevelopmentBrowserOrigin(transport);

	return `${transport.scheme}://${transport.directHost}`;
}

/** Returns whether an absolute URL has the expected normalized origin. */
function _MatchesOrigin(value: string, expectedOrigin: string): boolean
{
	try
	{
		return new URL(value).origin === expectedOrigin;
	}
	catch
	{
		return false;
	}
}

/** Accepts the Codespaces loopback rewrite only with matching external browser evidence. */
function _HasExpectedCodespacesOriginRewrite(request: Request, expectedOrigin: string, transport: DevelopmentAuthenticationTransport): boolean
{
	const origin = request.get("origin");
	const referer = request.get("referer");

	return (
		origin !== undefined
		&& referer !== undefined
		&& typeof request.headers["x-forwarded-host"] === "string"
		&& transport.browserScheme === "https"
		&& transport.scheme === "http"
		&& _MatchesOrigin(origin, _CODESPACES_REWRITTEN_ORIGIN)
		&& _MatchesOrigin(referer, expectedOrigin)
		&& request.get("sec-fetch-site") === "same-origin"
	);
}

/** Builds the browser-origin authority selected by one frozen development transport tuple. */
export function _CreateDevelopmentBrowserOriginAuthority(transport: DevelopmentAuthenticationTransport): SameOriginBrowserRequestAuthority
{
	return {
		isSameOrigin(request): boolean
		{
			if (!_HasExpectedDevelopmentHost(request, transport))
				return false;
			const expectedOrigin = _ExpectedOrigin(request, transport);
			const hasUrlEvidence = request.get("origin") !== undefined || request.get("referer") !== undefined;

			if (!hasUrlEvidence && typeof request.headers["x-forwarded-host"] !== "string")
				return false;

			if (_HasExpectedCodespacesOriginRewrite(request, expectedOrigin, transport))
				return true;

			return _HasSameOriginBrowserEvidence(request, expectedOrigin);
		},
	};
}
