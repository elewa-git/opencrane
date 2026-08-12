import { AgentThreadSummaryTargetKinds, type AgentThreadSnapshot, type AgentThreadSummaryTarget } from "@opencrane/state/conversation/agent-threads";

/**
 * Accepts a browser-history focus target only when it belongs to the authorized child snapshot.
 *
 * The routed page calls this after loading current server state. A missing or stale history target
 * falls back to the target selected by that snapshot, so browser history cannot focus guessed or
 * removed child coordinates.
 *
 * Called by: `AgentThreadPageComponent._AfterAuthorizedRender`.
 * @param requested - Target retained in browser history, or null when none was retained.
 * @param snapshot - Current authorized child projection.
 * @returns The requested target when it is present, otherwise the snapshot-owned fallback.
 */
export function _AgentThreadAuthorizedFocusTarget(requested: AgentThreadSummaryTarget | null, snapshot: AgentThreadSnapshot): AgentThreadSummaryTarget
{
	if (requested === null) return snapshot.summary.target;
	if (requested.kind === AgentThreadSummaryTargetKinds.Thread && requested.id === "agent-thread-origin") return requested;
	if (snapshot.timeline.some(entry => entry.id === requested.id)) return requested;
	return snapshot.summary.target;
}
