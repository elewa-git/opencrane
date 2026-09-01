import { RunExecutionPersonalMemoryPolicies, type InitialRunAuthority, type RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import type { ExecutionSubject } from "@opencrane/models/agents";

import type { ConversationContextInput, MemoryScopeInput, MemoryScopeSource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types";

/** Selects the sole memory source allowed by the explicit policy frozen for one run. */
export class RunPolicyMemoryScopeSource implements MemoryScopeSource
{
	/** Reads verified personal memory only for runs whose explicit policy permits it. */
	private readonly personalMemoryScope: MemoryScopeSource;

	/** Creates a policy switch over the personal-memory authority. */
	constructor(personalMemoryScope: MemoryScopeSource)
	{
		this.personalMemoryScope = personalMemoryScope;
	}

	/** Loads an empty scope or delegates to personal memory according to the frozen run policy. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, executionSubject: ExecutionSubject, conversation: ConversationContextInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<MemoryScopeInput>>
	{
		if (run.executionPolicy.personalMemory === RunExecutionPersonalMemoryPolicies.None)
		{
			return { outcome: "loaded", value: { memoryQueryPolicy: { scope: "none" }, datasetId: null } };
		}
		if (run.executionPolicy.personalMemory !== RunExecutionPersonalMemoryPolicies.Allowed)
		{
			return { outcome: "denied", reason: "memory_scope_unavailable" };
		}
		return this.personalMemoryScope.load(command, run, executionSubject, conversation, transaction);
	}
}
