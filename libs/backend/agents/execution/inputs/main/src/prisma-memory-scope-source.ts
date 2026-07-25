import { AuthorizationScopeKind, MemoryConsentState, MemoryDatasetState, MemoryFactState } from "@prisma/client";

import type { MemoryFactReference } from "@opencrane/contracts";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { MemoryScopeInput, MemoryScopeSource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types.js";

/** Maximum recalled personal facts frozen into one immutable prompt input. */
const _MAX_PERSONAL_MEMORY_FACTS = 100;

/** Canonical UTC timestamp required for provenance frozen into a run-input digest. */
const _ISO_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/** Transaction-fenced source for consented, provenance-backed personal memory context. */
export class PrismaMemoryScopeSource implements MemoryScopeSource
{
	/** Load a bounded personal memory scope for the delegated user, or no personal memory for managed runs. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<MemoryScopeInput>>
	{
		if (run.agentKind === "managed") return { outcome: "loaded", value: _NoMemoryScope() };
		if (run.delegatedUserId === null || run.delegatedUserId !== command.executionSubjectId) return { outcome: "denied", reason: "memory_scope_unavailable" };

		// 1. Discover only the user-owned Personal dataset; no shared scope is implicitly eligible.
		const dataset = await transaction.prisma.memoryDataset.findFirst({
			where: { siloId: command.siloId, scopeKind: AuthorizationScopeKind.Personal, scopeResourceId: run.delegatedUserId, state: MemoryDatasetState.Active },
			select: { id: true },
		});
		if (dataset === null) return { outcome: "loaded", value: _NoMemoryScope() };

		// 2. Pin only active, consented catalog records and discard malformed provenance rather than guessing it.
		const facts = await transaction.prisma.memoryFactCatalog.findMany({
			where: { datasetId: dataset.id, state: MemoryFactState.Active, consentState: { in: [MemoryConsentState.Explicit, MemoryConsentState.Confirmed] } },
			orderBy: [{ recordedAt: "desc" }, { id: "asc" }],
			take: _MAX_PERSONAL_MEMORY_FACTS,
			select: { id: true, contentDigest: true, provenance: true },
		});
		const memoryFacts = facts.map(function _toReference(fact) { return _MemoryReference(dataset.id, fact); }).filter(function _present(fact): fact is MemoryFactReference { return fact !== null; });
		return { outcome: "loaded", value: { memoryQueryPolicy: { kind: "personal", datasetId: dataset.id, subjectId: run.delegatedUserId, maxFacts: _MAX_PERSONAL_MEMORY_FACTS }, memoryFacts } };
	}
}

/** Return the explicit no-memory policy used when no personal dataset is authorized for this run. */
function _NoMemoryScope(): MemoryScopeInput
{
	return { memoryQueryPolicy: { kind: "none" }, memoryFacts: [] };
}

/** Convert one catalog row only when it contains a complete canonical provenance record. */
function _MemoryReference(datasetId: string, fact: { readonly id: string; readonly contentDigest: string; readonly provenance: unknown }): MemoryFactReference | null
{
	const provenance = _MemoryProvenance(fact.provenance);
	if (provenance === null || !/^sha256:[a-f0-9]{64}$/.test(fact.contentDigest)) return null;
	return { datasetId, factId: fact.id, contentDigest: fact.contentDigest, provenance: [provenance] };
}

/** Parse the one structured provenance record required before a catalog fact can reach a prompt. */
function _MemoryProvenance(value: unknown): MemoryFactReference["provenance"][number] | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Readonly<Record<string, unknown>>;
	const sourceKind = record["sourceKind"];
	const sourceId = record["sourceId"];
	const capturedAt = record["capturedAt"];
	if (typeof sourceKind !== "string" || sourceKind.trim().length === 0 || typeof sourceId !== "string" || sourceId.trim().length === 0 || typeof capturedAt !== "string" || !_ISO_UTC_INSTANT.test(capturedAt) || !Number.isFinite(Date.parse(capturedAt))) return null;
	const artifactRevisionId = typeof record["artifactRevisionId"] === "string" && record["artifactRevisionId"].trim().length > 0 ? record["artifactRevisionId"] : undefined;
	const sourceUserId = typeof record["sourceUserId"] === "string" && record["sourceUserId"].trim().length > 0 ? record["sourceUserId"] : undefined;
	return { sourceKind, sourceId, capturedAt, ...(artifactRevisionId === undefined ? {} : { artifactRevisionId }), ...(sourceUserId === undefined ? {} : { sourceUserId }) };
}
