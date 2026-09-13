import type { ComputerLease, ComputerScope, ConversationComputer, LeaseScope } from "@opencrane/contracts";

/**
 * Copies the four ownership coordinates out of a stored computer snapshot.
 *
 * Called by: the activation, lifecycle and checkpoint authorities when they turn canonical Kurrent
 * history into a projection or credential command.
 * @see ComputerScope
 */
export function _ComputerScopeOf(computer: ConversationComputer): ComputerScope
{
	return { siloId: computer.siloId, conversationId: computer.conversationId, computerId: computer.id, agentIdentityId: computer.agentIdentityId };
}

/**
 * Copies the lease id and generation out of a stored lease snapshot.
 *
 * The snapshot calls the generation `generation`; every in-memory command calls it `leaseGeneration`,
 * so this is the one place the two names meet.
 * @see LeaseScope
 */
export function _LeaseScopeOf(lease: ComputerLease): LeaseScope
{
	return { leaseId: lease.id, leaseGeneration: lease.generation };
}
