import type { A2uiSurfacePresentation } from "@opencrane/elements/a2ui";
import type { ConversationAssetPresentation } from "@opencrane/features/conversation-assets";
import type { AgentThreadParentRestoreIntent, AgentThreadSummaryTarget } from "@opencrane/state/conversation/agent-threads";
import type { ConversationActivityRow, ConversationElicitation } from "@opencrane/state/conversation/elicitation";

/**
 * What the parent chat workspace leaves in `history.state` when it opens an Agent-thread child route.
 *
 * The Agent-thread page needs two things the child URL cannot carry: where to put focus inside the
 * child, and how to get back to the exact message the reader left in the parent. Both ride the
 * browser history entry rather than a shared service, so they survive back, forward, and a reload of
 * the child URL, and so two history entries for the same child can remember different positions.
 *
 * Both fields are optional because nothing writes them in this build: the `/chats` index is still
 * the `chats-pending` placeholder, and the parent workspace that captures these coordinates arrives
 * with #351. A reader who opens the child URL directly gets an entry holding only Angular Router's
 * own keys, so the route component treats a missing field as "no restoration available".
 *
 * Called by: apps/opencrane-ui/src/app/agent-thread/agent-thread-route.component.ts.
 * @see AgentThreadPageComponent for the page that consumes both fields as inputs.
 */
export interface AgentThreadRouteHistoryState
{
	/**
	 * Names the parent message and scroll anchor to restore when the reader leaves the child.
	 *
	 * The route component ignores this unless `parentConversationId` matches the parent in the
	 * current URL, because a history entry can outlive the route that wrote it.
	 */
	readonly parentRestore?: AgentThreadParentRestoreIntent;
	/**
	 * Names the child timeline entry the reader clicked in the compact parent summary.
	 *
	 * The page focuses and scrolls to it after the first authorized render. It is dropped from
	 * history on an access purge, so a revoked child cannot be re-opened at a remembered position.
	 */
	readonly focusTarget?: AgentThreadSummaryTarget;
}

/**
 * The child-derived values the Angular application route holds itself, outside the Agent-thread store.
 *
 * Activity rows, elicitations, assets, and A2UI surfaces belong to other feature packages, so the
 * route composes them and passes them down as inputs instead of the Agent-thread store owning them.
 * That split is what makes a purge a two-part job: the store clears its own snapshot, and the route
 * has to clear this shape in the same turn.
 *
 * Used by: `_PurgedAgentThreadRouteProjection`, which returns the emptied value that
 * `purgeChildProjection` in agent-thread-route.component.ts assigns to its signals.
 */
export interface AgentThreadRouteProjection
{
	/** Activity rows derived from the child conversation. */
	readonly activityRows: readonly ConversationActivityRow[];
	/** Active child elicitation, if one is visible. */
	readonly elicitation: ConversationElicitation | null;
	/** Child asset currently composed into the route. */
	readonly asset: ConversationAssetPresentation | null;
	/** Child A2UI surface currently composed into the route. */
	readonly a2uiSurface: A2uiSurfacePresentation | null;
	/** Requested child focus coordinate retained from browser history. */
	readonly focusTarget: AgentThreadSummaryTarget | null;
}
