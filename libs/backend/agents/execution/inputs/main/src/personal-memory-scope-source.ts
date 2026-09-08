import { __ResolvePersonalMemoryDataset, PersonalMemoryDatasetResolutionOutcomes, type PersonalMemoryAdmissionRepository } from "@opencrane/backend/agents/personal/memory";
import { RunExecutionPersonalMemoryPolicies, type InitialRunAuthority, type RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import type { ExecutionSubject } from "@opencrane/models/agents";

import { RunInputMemoryScopes, type ConversationContextInput, type MemoryScopeInput, type MemoryScopeSource, type SessionAssemblyCommand, type SessionAssemblyLoad } from "./session-assembly.types";

/**
 * Freezes the verified personal dataset coordinates when the run policy allows personal memory.
 *
 * The product database resolves the dataset from the verified Principal and silo. This source
 * reads no fact content and makes no gateway call. It saves both the product dataset id and the
 * gateway dataset id so a future admitted memory effect can use the frozen coordinates.
 *
 * Missing or malformed dataset coordinates deny admission with `memory_scope_unavailable`;
 * they never become an empty memory scope. The current text-chat policy skips this source.
 *
 * Constructed by: `__CreatePrismaSessionAssemblyAuthorities`.
 *
 * @implements MemoryScopeSource
 * @see __ResolvePersonalMemoryDataset
 */
export class PersonalMemoryScopeSource implements MemoryScopeSource
{
	/** Makes the reader that selects the user's memory dataset from the product database. */
	private readonly createPersonalMemory: (transaction: RunAdmissionTransaction) => PersonalMemoryAdmissionRepository;

	/** Creates the source over the injected personal-memory dataset authority. */
	constructor(createPersonalMemory: (transaction: RunAdmissionTransaction) => PersonalMemoryAdmissionRepository)
	{
		this.createPersonalMemory = createPersonalMemory;
	}

	/** Freezes verified recall coordinates without reading personal-memory content. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, executionSubject: ExecutionSubject, _conversation: ConversationContextInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<MemoryScopeInput>>
	{
		// 1. Personal memory is available only when the explicit run policy allows it.
		if (run.executionPolicy.personalMemory !== RunExecutionPersonalMemoryPolicies.Allowed)
		{
			return { outcome: "denied", reason: "memory_scope_unavailable" };
		}

		// 2. Find the one personal dataset from the principal already verified during admission.
		const resolved = await __ResolvePersonalMemoryDataset(this.createPersonalMemory(transaction), { siloId: command.siloId, principalId: executionSubject.principalId, subjectId: executionSubject.principalId });
		if (resolved.outcome === PersonalMemoryDatasetResolutionOutcomes.Denied)
		{
			return resolved;
		}

		// 3. The snapshot stores dataset coordinates without a recall query or memory content.
		return { outcome: "loaded", value: { memoryQueryPolicy: { scope: RunInputMemoryScopes.Personal, datasetId: resolved.dataset.datasetId, cogneeDatasetId: resolved.dataset.cogneeDatasetId }, datasetId: resolved.dataset.datasetId } };
	}
}
