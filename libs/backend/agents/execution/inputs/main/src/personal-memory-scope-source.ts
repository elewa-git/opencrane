import { __ResolvePersonalMemoryDataset, PersonalMemoryDatasetResolutionOutcomes, type PersonalMemoryAdmissionRepository } from "@opencrane/backend/agents/personal/memory";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { RunInputSnapshotIdentityKinds } from "@opencrane/contracts";
import { AgentServiceKinds } from "@opencrane/models/agents";

import type { PersonalMemoryFactSelector } from "./memory-fact-selector.types.js";
import type { IdentityEnvelopeInput, MemoryScopeInput, MemoryScopeSource, SessionAssemblyCommand, SessionAssemblyLoad, ThreadContextInput } from "./session-assembly.types.js";

/** Number of fact references frozen into one personal snapshot. */
const _MAX_FACTS = 8;

/** Longest recall query derived from the newest user turn; matches the gateway's query bound. */
const _MAX_QUERY_CHARACTERS = 2_000;

/** Memory-scope source that selects a personal Cognee dataset only from verified run identity. */
export class PersonalMemoryScopeSource implements MemoryScopeSource
{
	/** Product-database authority for exact personal dataset selection. */
	private readonly createPersonalMemory: (transaction: RunAdmissionTransaction) => PersonalMemoryAdmissionRepository;

	/** Gateway-backed admission-time fact selector; it returns references and digests, never fact text. */
	private readonly selector: PersonalMemoryFactSelector;

	/** Creates the source over the injected personal-memory dataset authority and fact selector. */
	constructor(createPersonalMemory: (transaction: RunAdmissionTransaction) => PersonalMemoryAdmissionRepository, selector: PersonalMemoryFactSelector)
	{
		this.createPersonalMemory = createPersonalMemory;
		this.selector = selector;
	}

	/** Freezes the verified personal dataset and gateway-selected fact references without accepting caller input. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, identity: IdentityEnvelopeInput, thread: ThreadContextInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<MemoryScopeInput>>
	{
		// 1. Personal datasets cannot enter a managed-service snapshot, even if a delegated user has signed membership.
		if (run.agentKind !== AgentServiceKinds.Personal) return { outcome: "denied", reason: "memory_scope_unavailable" };
		if (identity.kind !== RunInputSnapshotIdentityKinds.User) return { outcome: "denied", reason: "memory_scope_unavailable" };

		// 2. Resolve the sole personal dataset from identity already verified at the admission fence.
		const resolved = await __ResolvePersonalMemoryDataset(this.createPersonalMemory(transaction), { siloId: command.siloId, organizationId: identity.organizationId, subjectId: identity.executionSubjectId });
		if (resolved.outcome === PersonalMemoryDatasetResolutionOutcomes.Denied) return resolved;

		// 3. Derive the recall query from the newest user turn frozen in the same transaction; a run
		//    without any user message freezes only coordinates, so recall stays snapshot-bounded.
		const queryText = await _loadLatestUserMessageText(transaction, thread.messageIds);
		if (queryText === null)
		{
			return { outcome: "loaded", value: { memoryQueryPolicy: { scope: "personal", datasetId: resolved.dataset.datasetId, cogneeDatasetId: resolved.dataset.cogneeDatasetId }, memoryFacts: [] } };
		}

		// 4. Select fact references through the gateway and fail the admission closed on any selector
		//    failure; a silently empty selection could hide a broken memory plane from the snapshot.
		try
		{
			const references = await this.selector.select({ siloId: command.siloId, cogneeDatasetId: resolved.dataset.cogneeDatasetId, subjectId: identity.executionSubjectId, queryText, maxFacts: _MAX_FACTS });
			return {
				outcome: "loaded",
				value: {
					memoryQueryPolicy: { scope: "personal", datasetId: resolved.dataset.datasetId, cogneeDatasetId: resolved.dataset.cogneeDatasetId, queryText, maxFacts: _MAX_FACTS },
					memoryFacts: references.map(function _reference(reference) { return { datasetId: resolved.dataset.datasetId, factId: reference.factId, contentDigest: reference.contentDigest, provenance: [] }; }),
				},
			};
		}
		catch
		{
			return { outcome: "denied", reason: "memory_unavailable" };
		}
	}
}

/** Load the newest completed user turn's flattened text from the already-frozen message order, or null. */
async function _loadLatestUserMessageText(transaction: RunAdmissionTransaction, messageIds: readonly string[]): Promise<string | null>
{
	// 1. Walk the frozen transcript backwards so the newest user turn wins without loading every row.
	for (let index = messageIds.length - 1; index >= 0; index -= 1)
	{
		// The comparison uses Prisma's generated role value, an external persisted vocabulary this
		// package does not own; importing the client's enum here would cross the repository boundary.
		const row = await transaction.prisma.conversationMessage.findUnique({ where: { id: messageIds[index] }, select: { role: true, blocks: true } });
		if (row === null || row.role !== "User") continue;

		// 2. Flatten and bound the block payload so an oversized turn cannot exceed the gateway's query contract.
		const text = _messageText(row.blocks).slice(0, _MAX_QUERY_CHARACTERS);
		return text.trim().length > 0 ? text : null;
	}
	return null;
}

/** Flatten a message's block payload into deterministic plain text for the recall query. */
function _messageText(blocks: unknown): string
{
	if (typeof blocks === "string") return blocks;
	if (!Array.isArray(blocks)) return "";
	const parts: string[] = [];
	for (const block of blocks)
	{
		if (typeof block === "string") parts.push(block);
		else if (block && typeof block === "object" && !Array.isArray(block) && typeof (block as Record<string, unknown>)["text"] === "string") parts.push((block as Record<string, unknown>)["text"] as string);
	}
	return parts.join("\n");
}
