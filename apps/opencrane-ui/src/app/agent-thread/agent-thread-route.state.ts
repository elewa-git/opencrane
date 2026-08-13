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
 * Used by: `_PurgedAgentThreadRouteProjection` below, which returns the emptied value that
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

/**
 * Builds the emptied route projection to assign when the Agent-thread store purges a child.
 *
 * The store raises its purge generation in two situations: it lost access to a child it had already
 * shown, and it moved to a different parent/child pair. In both cases everything derived from the old
 * child must leave the screen, and the values this route holds are not the store's to clear — so the
 * route asks for them here and assigns all five at once. Returning a whole projection rather than
 * clearing signals one by one is what keeps a later field from being forgotten.
 *
 * Called by: `purgeChildProjection` in agent-thread-route.component.ts.
 * @returns Empty rows and null values for every child-derived field, including the focus target.
 */
export function _PurgedAgentThreadRouteProjection(): AgentThreadRouteProjection
{
	return { activityRows: [], elicitation: null, asset: null, a2uiSurface: null, focusTarget: null };
}

/**
 * Builds the history state to write back after a purge: the same entry, minus the child focus target.
 *
 * A purged child must not be re-opened at a remembered position, so the focus target has to go. The
 * rest of the entry has to stay: Angular Router keeps its own keys there (`navigationId`), and
 * `parentRestore` is still the reader's way back to the parent message. Replacing the entry with a
 * fresh object would break router history restoration and lose that return path.
 *
 * The parameter is `unknown` because `history.state` is whatever the previous page wrote — it can be
 * null on a first load, or a value this app never produced.
 *
 * Called by: `purgeChildProjection` in agent-thread-route.component.ts, which passes the result to
 * `history.replaceState`.
 * @param historyState - The current `history.state`, of any shape.
 * @returns Every key except `focusTarget`, or an empty object when the state is not a plain object.
 */
export function _AgentThreadHistoryAfterPurge(historyState: unknown): Readonly<Record<string, unknown>>
{
	if (typeof historyState !== "object" || historyState === null || Array.isArray(historyState)) return {};
	const { focusTarget: _discardedFocusTarget, ...retainedState } = historyState as Readonly<Record<string, unknown>>;
	return retainedState;
}
