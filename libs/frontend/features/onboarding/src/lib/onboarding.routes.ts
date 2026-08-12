import { Routes } from "@angular/router";

/**
 * The onboarding routes, lazy-loaded under `/onboarding`.
 *
 * `""` is the persona journey (interview, tie-breaking, review, ready) and `chat` is the first
 * conversation. Nothing here decides which one the user should be on: each page reads the server's
 * state and redirects, and anything unrecognised falls back to `""`.
 *
 * Loaded by: apps/opencrane-ui/src/app/app.routes.ts, behind ___OperatorAccessGuard.
 */
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
	{
		path: "chat",
		loadComponent: function loadChat()
		{
			return import("./chat/persona-first-chat-page.component").then(function pickChat(module)
			{
				return module.PersonaFirstChatPageComponent;
			});
		}
	},
	{ path: "**", redirectTo: "" }
];
