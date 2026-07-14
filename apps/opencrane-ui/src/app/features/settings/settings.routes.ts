import { Routes } from "@angular/router";

import { FoundationPageComponent } from "../../shared/components/foundation-page/foundation-page.component.js";

/** Coordinator-owned buildable route seam transferred to Workflow B at UI_SHARED_READY_SHA. */
export const SETTINGS_ROUTES: Routes =
[
	{ path: "", pathMatch: "full", component: FoundationPageComponent, data: { heading: "Settings UI foundation" } },
	{ path: "**", component: FoundationPageComponent, data: { heading: "Settings UI foundation" } }
];
