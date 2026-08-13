import type { AgentThreadRouteProjection } from "./agent-thread-route.state.types";

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
