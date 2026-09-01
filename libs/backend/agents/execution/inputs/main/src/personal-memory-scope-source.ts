import { __ResolvePersonalMemoryDataset, PersonalMemoryDatasetResolutionOutcomes, type PersonalMemoryAdmissionRepository } from "@opencrane/backend/agents/personal/memory";
import { RunExecutionPersonalMemoryPolicies, type InitialRunAuthority, type RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import type { ExecutionSubject } from "@opencrane/models/agents";

import type { ConversationContextInput, MemoryScopeInput, MemoryScopeSource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types";

/**
 * Chooses the personal Cognee dataset for a run and freezes the facts the gateway picked.
 *
 * Cognee is the third-party knowledge store behind the memory gateway, and a dataset is its
 * per-subject partition. This source never talks to Cognee directly: it resolves the dataset id from
 * the product database and hands it to the gateway client, which owns the recall call.
 *
 * The dataset comes from the already-verified identity, never from the caller, so a request cannot
 * name someone else's memory. The recall query comes from the newest user message in the
 * already-frozen transcript, so recall cannot reach beyond what the snapshot names.
 *
 * Fails closed: if the gateway selector throws, admission is refused with `memory_unavailable`
 * rather than freezing an empty fact set, which would be indistinguishable from a user having no
 * memories.
 *
 * Constructed by: `__CreatePrismaPersonalSessionAssemblyAuthorities`
 * (prisma-session-assembly-authorities.ts).
 *
 * @implements MemoryScopeSource
 * @see PersonalMemoryFactSelector
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

		// 3. Freeze only verified dataset coordinates. The model may later propose a bounded query via
		//    the declared memory tool, but user text and recalled content never enter the snapshot.
		return { outcome: "loaded", value: { memoryQueryPolicy: { scope: "personal", datasetId: resolved.dataset.datasetId, cogneeDatasetId: resolved.dataset.cogneeDatasetId }, datasetId: resolved.dataset.datasetId } };
	}
}
