/**
 * The one entry point for child Agent-thread contracts.
 *
 * Import everything about Agent threads from here. The files behind this barrel are not part of the
 * contract: `agent-thread.types.js` and `agent-thread.js` may be split or renamed, so a deep import
 * into either is a break waiting to happen. {@link AgentThreadDeliveryKinds} is re-exported from
 * `@opencrane/contracts` for the same reason — every server-side reader of delivery categories takes
 * it from this package, so the set can move without touching them.
 *
 * Do not come here for behaviour. This package holds words and one shape check with no I/O; the
 * transaction that creates a child conversation and its first run lives in
 * `@opencrane/backend/server/conversations`, the safe event stream in
 * `@opencrane/backend/conversations/projection`, and the browser's own Agent-thread state in
 * `@opencrane/state/conversation/agent-threads`. Nothing in those may be reached through this barrel,
 * and this package must not depend on them.
 *
 * @see ../README.md — what the package owns and where it sits in the flow.
 */

export { __DecideAgentThreadTarget } from "./agent-thread.js";
export { AgentThreadDeliveryKinds } from "@opencrane/contracts";
export { AgentThreadEventTypes, AgentThreadSummaryStates } from "./agent-thread.types.js";
export type { AgentThreadOrigin, AgentThreadParentDelivery, AgentThreadSummary, AgentThreadTarget, AgentThreadTargetDecision } from "./agent-thread.types.js";
