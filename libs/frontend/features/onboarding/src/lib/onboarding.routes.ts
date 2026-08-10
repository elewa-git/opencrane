import { Routes } from "@angular/router";

/** Lazy routes for the server-authoritative persona lifecycle and first-chat journey. */
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
