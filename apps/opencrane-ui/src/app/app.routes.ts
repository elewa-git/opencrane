import { Routes } from "@angular/router";

import { ___OperatorAccessGuard } from "./operator-access.guard";

/** Top-level route table; feature pages are lazy-loaded route containers. */
export const APP_ROUTES: Routes =
[
	{
		// Public sign-in landing. No access guard — this is the destination the
		// guard sends anonymous visitors to.
		path: "login",
		loadComponent: function loadLoginPage()
		{
			return import("./login/login-page.component").then(function pickLoginPage(m)
			{
				return m.LoginPageComponent;
			});
		}
	},
	{
		// First-run onboarding (OPS.1). Reached directly or via the first-run guard.
		path: "welcome",
		canActivate: [___OperatorAccessGuard],
		loadChildren: function loadWelcomeRoutes()
		{
			return import("@opencrane/features/welcome").then(function pickWelcomeRoutes(m)
			{
				return m.WELCOME_ROUTES;
			});
		}
	},
	{
		// MCP admin console (catalogue governance + access policy). Each screen
		// gates in-component on the customerAdmin capability.
		path: "admin",
		canActivate: [___OperatorAccessGuard],
		loadChildren: function loadMcpAdminRoutes()
		{
			return import("@opencrane/features/tools").then(function pickMcpAdminRoutes(m)
			{
				return m.MCP_ADMIN_ROUTES;
			});
		}
	},
	{ path: "", pathMatch: "full", redirectTo: "welcome" },
	{
		path: "**",
		redirectTo: ""
	}
];
