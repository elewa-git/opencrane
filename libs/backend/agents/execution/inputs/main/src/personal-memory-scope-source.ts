import { __ResolvePersonalMemoryDataset } from "@opencrane/backend/agents/personal/memory";
import type { PersonalMemoryDatasetRepository } from "@opencrane/backend/agents/personal/memory";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { IdentityEnvelopeInput, MemoryScopeInput, MemoryScopeSource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types.js";

/** Memory-scope source that selects a personal Cognee dataset only from verified run identity. */
export class PersonalMemoryScopeSource implements MemoryScopeSource
{
	/** Product-database authority for exact personal dataset selection. */
	private readonly datasets: PersonalMemoryDatasetRepository;

	/** Creates the source over the injected personal-memory dataset authority. */
	constructor(datasets: PersonalMemoryDatasetRepository)
	{
		this.datasets = datasets;
	}

	/** Freezes the verified personal dataset as recall policy without accepting a caller-selected dataset. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, identity: IdentityEnvelopeInput, _transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<MemoryScopeInput>>
	{
		// 1. Personal datasets cannot enter a managed-service snapshot, even if a delegated user has signed membership.
		if (run.agentKind !== "personal") return { outcome: "denied", reason: "memory_scope_unavailable" };

		// 2. Resolve the sole personal dataset from identity already verified at the admission fence.
		const resolved = await __ResolvePersonalMemoryDataset(this.datasets, { siloId: command.siloId, organizationId: identity.organizationId, subjectId: identity.executionSubjectId });
		if (resolved.outcome === "denied") return resolved;

		// 3. Freeze only catalog and gateway coordinates; retrieval itself remains a later runtime-gateway action.
		return { outcome: "loaded", value: { memoryQueryPolicy: { scope: "personal", datasetId: resolved.dataset.datasetId, cogneeDatasetId: resolved.dataset.cogneeDatasetId }, memoryFacts: [] } };
	}
}
