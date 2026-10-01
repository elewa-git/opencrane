import type { Request } from "express";

import type { SameOriginBrowserRequestAuthority } from "./browser-origin-authority.types";
import { _RequestHost } from "./request-host";

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

/**
 * Checks browser URL and fetch-metadata evidence against an origin selected by a trusted caller.
 * A present Origin takes precedence over Referer, and foreign fetch metadata always fails closed.
 */
export function _HasSameOriginBrowserEvidence(request: Request, expectedOrigin: string): boolean
{
	const site = request.get("sec-fetch-site");

	if (site !== undefined && site !== "same-origin")
		return false;
	const origin = request.get("origin");

	if (origin !== undefined)
		return _MatchesOrigin(origin, expectedOrigin);
	const referer = request.get("referer");

	if (referer !== undefined)
		return _MatchesOrigin(referer, expectedOrigin);

	return site === "same-origin";
}

/** Builds the production authority from the proxy-aware protocol and shared effective request host. */
export function _CreateRequestBrowserOriginAuthority(): SameOriginBrowserRequestAuthority
{
	return {
		isSameOrigin(request): boolean
		{
			const host = _RequestHost(request)?.trim();

			if (!host || (request.protocol !== "http" && request.protocol !== "https"))
				return false;
			const expectedOrigin = `${request.protocol}://${host}`;

			try
			{
				if (new URL(expectedOrigin).origin !== expectedOrigin)
					return false;
			}
			catch
			{
				return false;
			}

			return _HasSameOriginBrowserEvidence(request, expectedOrigin);
		},
	};
}
