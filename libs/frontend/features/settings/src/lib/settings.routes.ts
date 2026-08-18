import { Routes } from "@angular/router";

import { MembersRouteComponent } from "./members/members-route.component";
import { SettingsShellComponent } from "./settings-shell.component";

/** Settings child routes; every visible navigation item has a real destination. */
export const SETTINGS_ROUTES: Routes = [
	{
		path: "",
		component: SettingsShellComponent,
		children: [
			{ path: "", pathMatch: "full", redirectTo: "members" },
			{ path: "members", component: MembersRouteComponent }
		]
	}
];
