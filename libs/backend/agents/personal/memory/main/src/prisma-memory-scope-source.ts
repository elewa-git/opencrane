import { AuthorizationScopeKind, MemoryConsentState, MemoryDatasetState, MemoryFactState } from "@prisma/client";
import type { MemoryFactReference } from "@opencrane/contracts";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import type { MemoryScopeInput, MemoryScopeSource, SessionAssemblyCommand, SessionAssemblyLoad } from "@opencrane/backend/agents/execution/inputs";

/** Freezes only active, consented personal facts into a personal run's immutable input snapshot. */
export class PrismaMemoryScopeSource implements MemoryScopeSource
{
	/** Loads same-silo facts recorded by the execution subject and forbids broad runtime retrieval. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<MemoryScopeInput>>
	{
		// 1. Managed work has no personal-memory authority in this first target slice.
		if (run.agentKind !== "personal") return { outcome: "loaded", value: { memoryFacts: [], memoryQueryPolicy: { mode: "pinned-only", datasetIds: [] } } };

		// 2. Select only facts that are active, consented, in this silo, and personally recorded.
		const rows = await transaction.prisma.memoryFactCatalog.findMany({
			where: {
				recordedBy: command.executionSubjectId,
				state: MemoryFactState.Active,
				consentState: { in: [MemoryConsentState.Explicit, MemoryConsentState.Confirmed] },
				dataset: { siloId: command.siloId, state: MemoryDatasetState.Active, scopeKind: AuthorizationScopeKind.Personal, scopeResourceId: command.executionSubjectId },
			},
			select: { id: true, datasetId: true, contentDigest: true, sourceArtifactRevisionId: true, sourceMessageId: true, recordedAt: true },
			orderBy: [{ datasetId: "asc" }, { id: "asc" }],
		});

		// 3. Rebuild typed provenance from immutable coordinates; no raw catalog JSON reaches the runtime.
		const memoryFacts = rows.map(function _toReference(row): MemoryFactReference
		{
			const capturedAt = row.recordedAt.toISOString();
			if (row.sourceArtifactRevisionId !== null) return { datasetId: row.datasetId, factId: row.id, contentDigest: row.contentDigest, provenance: [{ sourceKind: "artifact", sourceId: row.sourceArtifactRevisionId, artifactRevisionId: row.sourceArtifactRevisionId, capturedAt }] };
			if (row.sourceMessageId !== null) return { datasetId: row.datasetId, factId: row.id, contentDigest: row.contentDigest, provenance: [{ sourceKind: "message", sourceId: row.sourceMessageId, capturedAt }] };
			return { datasetId: row.datasetId, factId: row.id, contentDigest: row.contentDigest, provenance: [{ sourceKind: "explicit-user-fact", sourceId: row.id, sourceUserId: command.executionSubjectId, capturedAt }] };
		});
		const datasetIds = [...new Set(memoryFacts.map(function _datasetId(fact): string { return fact.datasetId; }))];
		return { outcome: "loaded", value: { memoryFacts, memoryQueryPolicy: { mode: "pinned-only", datasetIds } } };
	}
}
