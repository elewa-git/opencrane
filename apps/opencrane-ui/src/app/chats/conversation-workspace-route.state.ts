import type { NavigationExtras } from "@angular/router";

import type { ConversationThreadNavigationIntent } from "@opencrane/features/conversation-workspace";

/** App-owned child navigation command with exact parent restoration state. */
export interface ConversationThreadRouteNavigation
{
	/** Router command segments for the canonical breadcrumb child route. */
	readonly commands: readonly string[];
	/** Browser-history state consumed by the child route coordinator. */
	readonly extras: NavigationExtras;
}

/** Build the canonical URL segments for one selected normal conversation. */
export function _ConversationRouteCommands(conversationId: string | null): readonly string[]
{
	return conversationId === null ? ["/chats"] : ["/chats", conversationId];
}

/** Build exact child-route and parent-restoration coordinates from the feature intent. */
export function _ConversationThreadRouteNavigation(intent: ConversationThreadNavigationIntent): ConversationThreadRouteNavigation
{
	return {
		commands: ["/chats", intent.parentConversationId, "threads", intent.childConversationId],
		extras: { state: { parentRestore: { parentConversationId: intent.parentConversationId, parentMessageId: intent.parentMessageId, parentScrollAnchor: intent.parentMessageId } } }
	};
}
