import { __ResolvePersonalMemoryDataset, PersonalMemoryDatasetResolutionOutcomes, type PersonalMemoryAdmissionRepository } from "@opencrane/backend/agents/personal/memory";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { RunInputSnapshotIdentityKinds } from "@opencrane/contracts";
import { AgentServiceKinds } from "@opencrane/models/agents";

import type { PersonalMemoryFactSelector } from "./memory-fact-selector.types.js";
import type { IdentityEnvelopeInput, MemoryScopeInput, MemoryScopeSource, SessionAssemblyCommand, SessionAssemblyLoad, ConversationContextInput } from "./session-assembly.types.js";

/** Most fact references frozen into one personal snapshot. */
const _MAX_FACTS = 8;

/** Longest recall query derived from the newest user turn; matches the gateway's query bound. */
const _MAX_QUERY_CHARACTERS = 2_000;

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

	/** Picks facts through the memory gateway during admission. It returns ids and digests, never fact text. */
	private readonly selector: PersonalMemoryFactSelector;

	/** Creates the source over the injected personal-memory dataset authority and fact selector. */
	constructor(createPersonalMemory: (transaction: RunAdmissionTransaction) => PersonalMemoryAdmissionRepository, selector: PersonalMemoryFactSelector)
	{
		this.createPersonalMemory = createPersonalMemory;
		this.selector = selector;
	}

	/** Freezes the verified personal dataset and the facts the gateway picked. The caller supplies none of it. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, identity: IdentityEnvelopeInput, conversation: ConversationContextInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<MemoryScopeInput>>
	{
		// 1. Personal datasets cannot enter a managed-service snapshot, even if a delegated user has signed membership.
		if (run.agentKind !== AgentServiceKinds.Personal) return { outcome: "denied", reason: "memory_scope_unavailable" };
		if (identity.kind !== RunInputSnapshotIdentityKinds.User) return { outcome: "denied", reason: "memory_scope_unavailable" };

		// 2. Find the one personal dataset from the identity already verified during admission.
		const resolved = await __ResolvePersonalMemoryDataset(this.createPersonalMemory(transaction), { siloId: command.siloId, organizationId: identity.organizationId, subjectId: identity.executionSubjectId });
		if (resolved.outcome === PersonalMemoryDatasetResolutionOutcomes.Denied) return resolved;

		// 3. Build the recall query from the newest user message frozen in this transaction. A run with
		//    no user message stores the dataset ids and no facts, so recall can never go beyond the snapshot.
		const pendingQueryText = conversation.pendingUserMessage === null ? null : _messageText(conversation.pendingUserMessage.blocks).slice(0, _MAX_QUERY_CHARACTERS).trim();
		const queryText = conversation.pendingUserMessage === null
			? await _loadLatestUserMessageText(transaction, conversation.messageIds)
			: (pendingQueryText && pendingQueryText.length > 0 ? pendingQueryText : null);
		if (queryText === null)
		{
			return { outcome: "loaded", value: { memoryQueryPolicy: { scope: "personal", datasetId: resolved.dataset.datasetId, cogneeDatasetId: resolved.dataset.cogneeDatasetId }, memoryFacts: [] } };
		}

		// 4. Pick fact references through the gateway. If the selector fails, refuse the admission: an
		//    empty result would hide a broken memory gateway instead of reporting it.
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

/** Returns the text of the newest completed user message in the frozen transcript, or null if there is none. */
async function _loadLatestUserMessageText(transaction: RunAdmissionTransaction, messageIds: readonly string[]): Promise<string | null>
{
	// 1. Walk the frozen transcript backwards so the newest user turn wins without loading every row.
	for (let index = messageIds.length - 1; index >= 0; index -= 1)
	{
		// The comparison uses Prisma's generated role value, an external persisted vocabulary this
		// package does not own; importing the client's enum here would cross the repository boundary.
		const row = await transaction.prisma.conversationMessage.findUnique({ where: { id: messageIds[index] }, select: { role: true, blocks: true } });
		if (row === null || row.role !== "User") continue;

		// 2. Flatten the message blocks and cut the text short, so a huge message stays inside the gateway's query limit.
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
		else if (block && typeof block === "object" && !Array.isArray(block))
		{
			const candidate = block as Record<string, unknown>;
			if (candidate["kind"] === "text" && typeof candidate["value"] === "string") parts.push(candidate["value"]);
			else if (typeof candidate["text"] === "string") parts.push(candidate["text"]);
		}
	}
	return parts.join("\n");
}
