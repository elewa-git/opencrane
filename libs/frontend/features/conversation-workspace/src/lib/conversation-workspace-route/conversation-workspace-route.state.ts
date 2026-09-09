
/**
 * Build the canonical URL segments for one selected normal conversation.
 *
 * Selection lives in the URL so a reload or a shared link reopens the same conversation, and this
 * function is the single place that decides that shape. Passing null is not an error case: the
 * workspace store returns `{ conversationId: null }` when archiving leaves no non-archived row, and
 * the correct URL then is the bare index rather than a route pointing at a conversation that is gone.
 *
 * Called by: `ConversationWorkspaceRouteComponent.selectConversation` in
 * `conversation-workspace-route.component.ts`.
 *
 * @param conversationId - The conversation to select, or null when nothing is selectable.
 * @returns `["/chats", id]` for a selection, or `["/chats"]` for the index. Segments, not a string,
 * because `Router.navigate` escapes each segment itself.
 * @see ConversationWorkspaceNavigationIntent in `@opencrane/state/conversation/workspace` for where
 * the null comes from.
 */
export function _ConversationRouteCommands(conversationId: string | null): readonly string[]
{
	return conversationId === null ? ["/chats"] : ["/chats", conversationId];
}
