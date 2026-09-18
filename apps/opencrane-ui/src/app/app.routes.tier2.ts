import { Routes } from "@angular/router";

import { OPENCRANE_LIVE_ROUTES } from "./app.routes.live";
import { OPENCRANE_TIER2_DEVELOPMENT_SESSION_CREDENTIAL, OPENCRANE_TIER2_DEVELOPMENT_SESSION_GUIDANCE_STATE } from "./local-development/tier2-development-session";

/** Selects the guidance page when this page session has no current launcher credential. */
function _tier2Routes(): Routes
{
	if (OPENCRANE_TIER2_DEVELOPMENT_SESSION_CREDENTIAL)
		return OPENCRANE_LIVE_ROUTES;

	return [
		{
			path: "**",
			data: { guidanceState: OPENCRANE_TIER2_DEVELOPMENT_SESSION_GUIDANCE_STATE },
			loadComponent: function loadDevelopmentSessionRequiredPage()
			{
				return import("./local-development/tier2-development-session-required-page.component").then(function pickDevelopmentSessionRequiredPage(m)
				{
					return m.Tier2DevelopmentSessionRequiredPageComponent;
				});
			}
		}
	];
}

/** Tier 2 route table selected before guarded live routes can start an authentication request. */
export const APP_ROUTES = _tier2Routes();
