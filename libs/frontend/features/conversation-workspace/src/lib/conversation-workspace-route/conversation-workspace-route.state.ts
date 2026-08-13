import type { ConversationThreadNavigationIntent } from "../conversation-workspace-feature.types.js";
import type { ConversationThreadRouteNavigation } from "./conversation-workspace-route.state.types.js";

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

/**
 * Turn the feature's "open this thread" request into a child URL plus the state that returns from it.
 *
 * The workspace page emits an intent and its feature-local route coordinator decides both the URL
 * and what the child will be able to use to come back. The return coordinates travel as
 * browser-history state, which is what makes the back journey exact: `AgentThreadRouteComponent`
 * reads `parentRestore` off the history entry and accepts it only when its parent conversation
 * matches the route it is on, and `AgentThreadPageComponent.returnToParent` additionally checks
 * `parentMessageId` against the conversation it actually loaded before honouring it. State that
 * belongs to a different parent is therefore ignored rather than followed.
 *
 * `parentScrollAnchor` repeats `parentMessageId` because the workspace has no separate scroll
 * coordinate to give: {@link ConversationThreadNavigationIntent} carries only the parent message,
 * while `AgentThreadParentRestoreIntent` requires an anchor, so the originating message doubles as
 * the place to return to.
 *
 * Called by: `ConversationWorkspaceRouteComponent.openThread` in
 * `conversation-workspace-route.component.ts`.
 *
 * @param intent - Parent conversation, child conversation, and the parent message the thread grew from.
 * @returns Segments and history state to pass to `Router.navigate` together. Nothing is validated
 * here; the child route re-checks the parent before trusting it.
 * @see conversation-workspace-route.state.spec.ts — `_ChildThreadRoute` pins this exact shape.
 */
export function _ConversationThreadRouteNavigation(intent: ConversationThreadNavigationIntent): ConversationThreadRouteNavigation
{
	return {
		commands: ["/chats", intent.parentConversationId, "threads", intent.childConversationId],
		extras: { state: { parentRestore: { parentConversationId: intent.parentConversationId, parentMessageId: intent.parentMessageId, parentScrollAnchor: intent.parentMessageId } } }
	};
}
