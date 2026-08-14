import type { Routes } from "@angular/router";

/** Feature-owned child routes mounted by the application at `/chats`. */
export const CONVERSATION_WORKSPACE_ROUTES: Routes =
[
	{
		path: ":conversationId",
		loadComponent: function loadSelectedConversation()
		{
			return import("./conversation-workspace-route.component").then(function pickConversationWorkspaceRoute(module)
			{
				return module.ConversationWorkspaceRouteComponent;
			});
		}
	},
	{
		path: "",
		pathMatch: "full",
		loadComponent: function loadConversationIndex()
		{
			return import("./conversation-workspace-route.component").then(function pickConversationWorkspaceRoute(module)
			{
				return module.ConversationWorkspaceRouteComponent;
			});
		}
	}
];
