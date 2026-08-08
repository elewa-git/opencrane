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
		// Server-authoritative persona survey, review, and bounded first-chat journey.
		path: "onboarding",
		canActivate: [___OperatorAccessGuard],
		loadChildren: function loadOnboardingRoutes()
		{
			return import("@opencrane/features/onboarding").then(function pickOnboardingRoutes(m)
			{
				return m.ONBOARDING_ROUTES;
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
	{ path: "", pathMatch: "full", redirectTo: "onboarding/survey" },
	{
		path: "**",
		redirectTo: ""
	}
];
