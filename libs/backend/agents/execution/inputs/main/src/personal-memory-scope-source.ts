import { __ResolvePersonalMemoryDataset, PersonalMemoryDatasetResolutionOutcomes, type PersonalMemoryAdmissionRepository } from "@opencrane/backend/agents/personal/memory";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { RunInputSnapshotIdentityKinds } from "@opencrane/contracts";
import { AgentServiceKinds } from "@opencrane/models/agents";

import type { IdentityEnvelopeInput, MemoryScopeInput, MemoryScopeSource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types.js";

/** Memory-scope source that selects a personal Cognee dataset only from verified run identity. */
export class PersonalMemoryScopeSource implements MemoryScopeSource
{
	/** Product-database authority for exact personal dataset selection. */
	private readonly personalMemory: PersonalMemoryAdmissionRepository;

	/** Creates the source over the injected personal-memory dataset authority. */
	constructor(personalMemory: PersonalMemoryAdmissionRepository)
	{
		this.personalMemory = personalMemory;
	}

	/** Freezes the verified personal dataset as recall policy without accepting a caller-selected dataset. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, identity: IdentityEnvelopeInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<MemoryScopeInput>>
	{
		// 1. Personal datasets cannot enter a managed-service snapshot, even if a delegated user has signed membership.
		if (run.agentKind !== AgentServiceKinds.Personal) return { outcome: "denied", reason: "memory_scope_unavailable" };
		if (identity.kind !== RunInputSnapshotIdentityKinds.User) return { outcome: "denied", reason: "memory_scope_unavailable" };

		// 2. Resolve the sole personal dataset from identity already verified at the admission fence.
		const resolved = await __ResolvePersonalMemoryDataset(this.personalMemory, transaction, { siloId: command.siloId, organizationId: identity.organizationId, subjectId: identity.executionSubjectId });
		if (resolved.outcome === PersonalMemoryDatasetResolutionOutcomes.Denied) return resolved;

		// 3. Freeze only catalog and gateway coordinates; retrieval itself remains a later runtime-gateway action.
		return { outcome: "loaded", value: { memoryQueryPolicy: { scope: "personal", datasetId: resolved.dataset.datasetId, cogneeDatasetId: resolved.dataset.cogneeDatasetId }, memoryFacts: [] } };
	}
}
