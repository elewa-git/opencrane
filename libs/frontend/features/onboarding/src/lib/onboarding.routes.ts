import { Routes } from "@angular/router";

/** Lazy routes for the server-authoritative persona survey, review, and first-chat journey. */
export const ONBOARDING_ROUTES: Routes =
[
	{
		path: "survey",
		loadComponent: function loadSurvey()
		{
			return import("./survey/persona-survey-page.component").then(function pickSurvey(module)
			{
				return module.PersonaSurveyPageComponent;
			});
		}
	},
	{
		path: "review",
		loadComponent: function loadReview()
		{
			return import("./review/persona-review-page.component").then(function pickReview(module)
			{
				return module.PersonaReviewPageComponent;
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
	{ path: "", pathMatch: "full", redirectTo: "survey" },
	{ path: "**", redirectTo: "survey" }
];
