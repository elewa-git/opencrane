import type { AgentThreadParentRestoreIntent, AgentThreadSummaryTarget } from "@opencrane/state/conversation/agent-threads";

/** Browser-history payload owned by the parent workspace route coordinator. */
export interface AgentThreadRouteHistoryState
{
	/** Exact parent message and scroll coordinate captured before opening the child. */
	readonly parentRestore?: AgentThreadParentRestoreIntent;
	/** Canonical child target selected from the compact parent summary. */
	readonly focusTarget?: AgentThreadSummaryTarget;
}
