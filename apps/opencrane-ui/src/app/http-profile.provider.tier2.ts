import { provideHttpClient, withFetch } from "@angular/common/http";
import { makeEnvironmentProviders } from "@angular/core";

import { CONTROL_PLANE_REQUEST_HEADERS, CONTROL_PLANE_UNAUTHORIZED_RESPONSE_HANDLER } from "@opencrane/core";

import { OPENCRANE_TIER2_DEVELOPMENT_SESSION_CREDENTIAL, _ReplaceTier2DevelopmentSession } from "./local-development/tier2-development-session";
import type { Tier2DevelopmentSessionDocumentReplacer } from "./local-development/tier2-development-session.types";

/** Public backend code that identifies a private browser session from an earlier Tier 2 launch. */
const _DEVELOPMENT_SESSION_REQUIRED = "DEVELOPMENT_SESSION_REQUIRED";

/**
 * Claims only the Tier 2 development-session 401 and moves the obsolete tab to guidance.
 * @param response - Unauthorized Control Plane response to classify.
 * @param replaceDocument - Browser navigation boundary, replaceable by focused tests.
 */
export async function _HandleTier2UnauthorizedResponse(response: Response, replaceDocument?: Tier2DevelopmentSessionDocumentReplacer): Promise<boolean>
{
	if (response.status !== 401)
		return false;

	let body: unknown;
	try
	{
		body = await response.clone().json();
	}
	catch
	{
		return false;
	}

	if (
		typeof body !== "object"
		|| body === null
		|| !("code" in body)
		|| body.code !== _DEVELOPMENT_SESSION_REQUIRED
	)
		return false;

	_ReplaceTier2DevelopmentSession(replaceDocument);
	return true;
}

/** Supplies the private session to the native Control Plane transport used by every live gateway. */
export const OPENCRANE_HTTP_PROVIDER = makeEnvironmentProviders([
	provideHttpClient(withFetch()),
	{
		provide: CONTROL_PLANE_REQUEST_HEADERS,
		useValue: !OPENCRANE_TIER2_DEVELOPMENT_SESSION_CREDENTIAL
			? {}
			: { "X-OpenCrane-Development-Session": OPENCRANE_TIER2_DEVELOPMENT_SESSION_CREDENTIAL }
	},
	{
		provide: CONTROL_PLANE_UNAUTHORIZED_RESPONSE_HANDLER,
		useValue: _HandleTier2UnauthorizedResponse
	}
]);
