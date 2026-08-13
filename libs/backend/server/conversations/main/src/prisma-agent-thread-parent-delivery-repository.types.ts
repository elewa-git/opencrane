import type { AgentThreadParentDeliveryCommand, AgentThreadRuntimeIdentity, DeliverAgentThreadParentResult } from "./agent-thread-parent-delivery.types.js";

/**
 * Persists one child-to-parent delivery against a transaction the unit of work already opened.
 *
 * This port keeps Prisma delegate ownership inside the repository while the unit of work retains
 * transaction isolation, tracing, and persistence-error handling.
 */
export interface AgentThreadParentDeliveryRepository
{
	/** Resolves runtime authority, the immediate parent, and idempotency before appending a delivery. */
	deliver(identity: AgentThreadRuntimeIdentity, command: AgentThreadParentDeliveryCommand): Promise<DeliverAgentThreadParentResult>;
}
