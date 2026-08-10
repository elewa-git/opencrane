import { Routes } from "@angular/router";

/** Lazy route for the server-authoritative persona lifecycle shell. */
export const ONBOARDING_ROUTES: Routes =
[
	{
		path: "",
		pathMatch: "full",
		loadComponent: function loadOnboarding()
		{
			return import("./persona-onboarding-page.component").then(function pickOnboarding(module)
			{
				return module.PersonaOnboardingPageComponent;
			});
		}
	},
	{ path: "**", redirectTo: "" }
];
