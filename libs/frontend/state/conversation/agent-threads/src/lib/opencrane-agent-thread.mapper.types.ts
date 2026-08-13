import type { paths } from "@opencrane/contracts";

import type { AgentThreadTimelineEntry } from "./agent-thread.types.js";

/** Validated child-conversation lifecycle values crossing the generated API boundary. */
export enum _AgentThreadLifecycleStates
{
	/** The child remains available for work after its current run settles. */
	Open = "open",
	/** The child is terminal and admits no further run. */
	Closed = "closed"
}

/** Generated success DTO for one exact authorized Agent-thread route. */
export type AgentThreadSnapshotDto = paths["/me/conversations/{parentConversationId}/agent-threads/{childConversationId}"]["get"]["responses"][200]["content"]["application/json"]["agentThread"];

/** One validated message row from the bounded Agent-thread response. */
export type AgentThreadMessageDto = AgentThreadSnapshotDto["messages"][number];

/** One validated run row from the bounded Agent-thread response. */
export type AgentThreadRunDto = AgentThreadSnapshotDto["runs"][number];

/** One validated delivery row from the bounded Agent-thread response. */
export type AgentThreadDeliveryDto = AgentThreadSnapshotDto["deliveries"][number];

/** Timeline entry paired with its canonical timestamp until stable ordering is complete. */
export interface AgentThreadTimelineRow
{
	/** Canonical instant used only for cross-kind ordering. */
	readonly occurredAt: string;
	/** Browser-safe entry retained after ordering. */
	readonly entry: AgentThreadTimelineEntry;
}
