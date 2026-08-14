import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { IdentityEnvelopeInput, MemoryScopeInput, MemoryScopeSource, SessionAssemblyCommand, SessionAssemblyLoad, ConversationContextInput } from "./session-assembly.types";

/**
 * Gives managed services an empty memory policy, until a managed knowledge scope is authorised
 * separately.
 *
 * Deliberately does nothing useful. It exists so managed admission has a real memory source to wire
 * in, instead of leaving the field optional — an optional field invites a future change to fall
 * back to a personal source, which would let a managed service read a user's dataset. It refuses
 * personal runs outright for the same reason.
 *
 * Constructed by: `__CreatePrismaManagedSessionAssemblyAuthorities`
 * (prisma-session-assembly-authorities.ts).
 *
 * @implements MemoryScopeSource
 */
export class ManagedNoPersonalMemoryScopeSource implements MemoryScopeSource
{
	/** Refuses personal services. Gives a managed run no personal dataset and no fact references. */
	async load(_command: SessionAssemblyCommand, run: InitialRunAuthority, identity: IdentityEnvelopeInput, _conversation: ConversationContextInput, _transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<MemoryScopeInput>>
	{
		// 1. Never let a personal service fall back to this managed-only empty policy.
		if (run.agentKind !== "managed" || identity.kind !== "service" || identity.agentServiceId !== run.agentServiceId) return { outcome: "denied", reason: "memory_scope_unavailable" };

		// 2. Freeze an explicit empty scope rather than silently reading an arbitrary user, organization, or workspace dataset.
		return { outcome: "loaded", value: { memoryQueryPolicy: { scope: "none" } } };
	}
}
