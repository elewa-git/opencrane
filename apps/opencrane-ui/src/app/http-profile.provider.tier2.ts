import { provideHttpClient, withFetch } from "@angular/common/http";
import { makeEnvironmentProviders } from "@angular/core";

import { CONTROL_PLANE_REQUEST_HEADERS } from "@opencrane/core";

import { OPENCRANE_TIER2_DEVELOPMENT_SESSION_CREDENTIAL } from "./local-development/tier2-development-session";

/** Supplies the private session to the native Control Plane transport used by every live gateway. */
export const OPENCRANE_HTTP_PROVIDER = makeEnvironmentProviders([
	provideHttpClient(withFetch()),
	{
		provide: CONTROL_PLANE_REQUEST_HEADERS,
		useValue: !OPENCRANE_TIER2_DEVELOPMENT_SESSION_CREDENTIAL
			? {}
			: { "X-OpenCrane-Development-Session": OPENCRANE_TIER2_DEVELOPMENT_SESSION_CREDENTIAL }
	}
]);
