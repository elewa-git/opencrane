import type { AgentThreadParentDeliveryCommand, AgentThreadRuntimeIdentity, DeliverAgentThreadParentResult } from "../agent-thread-parent-delivery.types";

/**
 * Persists one child-to-parent delivery against a transaction the unit of work already opened.
 *
 * This port keeps Prisma delegate ownership inside the repository while the unit of work retains
 * transaction isolation, tracing, and persistence-error handling.
 *
 * Called by: `PrismaAgentThreadParentDeliveryUnitOfWork.deliver`; implemented by
 * `PrismaAgentThreadParentDeliveryRepository`.
 */
export interface AgentThreadParentDeliveryRepository
{
	/**
	 * Resolves runtime authority, the immediate parent, and idempotency before appending a delivery.
	 *
	 * @param identity - Workload coordinates derived from the reviewed runtime token.
	 * @param command - The requested immediate-parent delivery and its idempotency key.
	 * @returns The appended delivery, its identical replay, or an authority or conflict denial.
	 * @throws When the transaction cannot complete a delegate call.
	 */
	deliver(identity: AgentThreadRuntimeIdentity, command: AgentThreadParentDeliveryCommand): Promise<DeliverAgentThreadParentResult>;
}
