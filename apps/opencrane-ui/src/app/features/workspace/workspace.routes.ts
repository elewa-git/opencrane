import { Routes } from "@angular/router";

import { FoundationPageComponent } from "../../shared/components/foundation-page/foundation-page.component.js";
import { RoutePlaceholderComponent } from "../../shared/components/route-placeholder/route-placeholder.component.js";

/** Coordinator-owned buildable route seam transferred to Workflow A at UI_SHARED_READY_SHA. */
export const WORKSPACE_ROUTES: Routes =
[
	{
		path: "",
		component: RoutePlaceholderComponent,
		children:
		[
			{ path: "", pathMatch: "full", component: FoundationPageComponent, data: { heading: "OpenCrane UI foundation" } },
			{ path: "session/:sessionId", component: FoundationPageComponent, data: { heading: "Session UI foundation" } },
			{
				path: "settings",
				loadChildren: function loadSettingsRoutes()
				{
					return import("../settings/settings.routes.js").then(function pickSettingsRoutes(module)
					{
						return module.SETTINGS_ROUTES;
					});
				}
			}
		]
	}
];
