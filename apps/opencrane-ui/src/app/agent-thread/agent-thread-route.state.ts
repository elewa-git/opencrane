import type { A2uiSurfacePresentation } from "@opencrane/elements/a2ui";
import type { ConversationAssetPresentation } from "@opencrane/features/conversation-assets";
import type { AgentThreadParentRestoreIntent, AgentThreadSummaryTarget } from "@opencrane/state/conversation/agent-threads";
import type { ConversationActivityRow, ConversationElicitation } from "@opencrane/state/conversation/elicitation";

/** Browser-history payload owned by the parent workspace route coordinator. */
export interface AgentThreadRouteHistoryState
{
	/** Exact parent message and scroll coordinate captured before opening the child. */
	readonly parentRestore?: AgentThreadParentRestoreIntent;
	/** Canonical child target selected from the compact parent summary. */
	readonly focusTarget?: AgentThreadSummaryTarget;
}

/** Child projections held by the application route outside the feature store. */
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

/** Remove every child-derived route projection after an access change. */
export function _PurgedAgentThreadRouteProjection(): AgentThreadRouteProjection
{
	return { activityRows: [], elicitation: null, asset: null, a2uiSurface: null, focusTarget: null };
}

/** Remove the child focus coordinate without discarding Angular Router or parent-restore state. */
export function _AgentThreadHistoryAfterPurge(historyState: unknown): Readonly<Record<string, unknown>>
{
	if (typeof historyState !== "object" || historyState === null || Array.isArray(historyState)) return {};
	const { focusTarget: _discardedFocusTarget, ...retainedState } = historyState;
	return retainedState;
}
