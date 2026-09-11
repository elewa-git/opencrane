import { provideHttpClient, withFetch } from "@angular/common/http";
import { makeEnvironmentProviders } from "@angular/core";

import { CONTROL_PLANE_REQUEST_HEADERS } from "@opencrane/core";

/** Names the query parameter used to deliver one private Tier 2 browser session. */
const _CREDENTIAL_QUERY = "development-session";

/** Names the per-tab browser storage entry cleared when the tab closes. */
const _CREDENTIAL_STORAGE = "opencrane.tier2.development-session";

/** Reads a new private URL credential once, then removes it from browser history. */
function _ReadDevelopmentSessionCredential(): string | null
{
	const url = new URL(window.location.href);
	const supplied = url.searchParams.get(_CREDENTIAL_QUERY);
	if (supplied !== null)
	{
		url.searchParams.delete(_CREDENTIAL_QUERY);
		window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
		if (/^[A-Za-z0-9_-]{43}$/u.test(supplied))
		{
			window.sessionStorage.setItem(_CREDENTIAL_STORAGE, supplied);
			return supplied;
		}
		window.sessionStorage.removeItem(_CREDENTIAL_STORAGE);
		return null;
	}
	return window.sessionStorage.getItem(_CREDENTIAL_STORAGE);
}

/** Retains the private session only inside the tab opened from the launcher URL. */
const _DEVELOPMENT_SESSION_CREDENTIAL = _ReadDevelopmentSessionCredential();

/** Supplies the private session to the native Control Plane transport used by every live gateway. */
export const OPENCRANE_HTTP_PROVIDER = makeEnvironmentProviders([
	provideHttpClient(withFetch()),
	{
		provide: CONTROL_PLANE_REQUEST_HEADERS,
		useValue: _DEVELOPMENT_SESSION_CREDENTIAL === null
			? {}
			: { "X-OpenCrane-Development-Session": _DEVELOPMENT_SESSION_CREDENTIAL }
	}
]);
