import { inject } from "@angular/core";
import { ActivatedRouteSnapshot, CanActivateFn, GuardResult, MaybeAsync, RouterStateSnapshot, Routes } from "@angular/router";

import { UI_ACCESS_GUARD, UI_FIRST_RUN_GUARD } from "./core/state/ui-data-source.tokens.js";

/** Delegates authenticated tenant access to the currently registered provider token. */
const _accessGuard: CanActivateFn = function _AccessGuard(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): MaybeAsync<GuardResult>
{
	return inject(UI_ACCESS_GUARD)(route, state);
};

/** Delegates first-run access to the currently registered provider token. */
const _firstRunGuard: CanActivateFn = function _FirstRunGuard(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): MaybeAsync<GuardResult>
{
	return inject(UI_FIRST_RUN_GUARD)(route, state);
};

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
		// Terminal screen for authenticated users with no UserTenant in this org.
		// No access guard — the guard is what routes users here.
		path: "no-tenant",
		loadComponent: function loadNoTenantPage()
		{
			return import("./no-tenant/no-tenant-page.component").then(function pickNoTenantPage(m)
			{
				return m.NoTenantPageComponent;
			});
		}
	},
	{
		// First-run onboarding (OPS.1). Reached directly or via the first-run guard.
		path: "welcome",
		canActivate: [_accessGuard],
		loadChildren: function loadWelcomeRoutes()
		{
			return import("@opencrane/features/welcome").then(function pickWelcomeRoutes(m)
			{
				return m.WELCOME_ROUTES;
			});
		}
	},
	{
		// Customer-admin console (OPS.4) — gated in-component on the customerAdmin capability.
		path: "customer-admin",
		canActivate: [_accessGuard],
		loadChildren: function loadCustomerAdminRoutes()
		{
			return import("@opencrane/features/customer-admin").then(function pickCustomerAdminRoutes(m)
			{
				return m.CUSTOMER_ADMIN_ROUTES;
			});
		}
	},
	{
		// MCP admin console (catalogue governance + access policy). Each screen
		// gates in-component on the customerAdmin capability.
		path: "admin",
		canActivate: [_accessGuard],
		loadChildren: function loadMcpAdminRoutes()
		{
			return import("@opencrane/features/tools").then(function pickMcpAdminRoutes(m)
			{
				return m.MCP_ADMIN_ROUTES;
			});
		}
	},
	{
		// Workspace shell (sidebar + popovers) hosting deep-linkable child routes
		// (session / settings) in its router-outlet. Gated by the access guard
		// (auth + tenant present), then the first-run guard.
		path: "",
		canActivate: [_accessGuard, _firstRunGuard],
		loadChildren: function loadWorkspaceRoutes()
		{
			return import("./features/workspace/workspace.routes.js").then(function pickWorkspaceRoutes(m)
			{
				return m.WORKSPACE_ROUTES;
			});
		}
	},
	{
		path: "**",
		redirectTo: ""
	}
];
