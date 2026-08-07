import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { IdentityEnvelopeInput, MemoryScopeInput, MemoryScopeSource, SessionAssemblyCommand, SessionAssemblyLoad, ThreadContextInput } from "./session-assembly.types.js";

/** Provides an explicit empty-memory policy for managed services until a separately authorized knowledge scope is attached. */
export class ManagedNoPersonalMemoryScopeSource implements MemoryScopeSource
{
	/** Refuses personal services and seals a managed run with no personal dataset or fact reference. */
	async load(_command: SessionAssemblyCommand, run: InitialRunAuthority, identity: IdentityEnvelopeInput, _thread: ThreadContextInput, _transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<MemoryScopeInput>>
	{
		// 1. Do not turn this deliberately narrow managed policy into a fallback for a personal service.
		if (run.agentKind !== "managed" || identity.kind !== "service" || identity.agentServiceId !== run.agentServiceId) return { outcome: "denied", reason: "memory_scope_unavailable" };

		// 2. Freeze an explicit empty scope rather than silently reading an arbitrary user, organization, or workspace dataset.
		return { outcome: "loaded", value: { memoryQueryPolicy: { scope: "none" }, memoryFacts: [] } };
	}
}
