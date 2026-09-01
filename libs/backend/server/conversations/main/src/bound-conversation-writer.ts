import { ___ConversationComputerEntrySchema, type ConversationEntry } from "@opencrane/contracts";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { BoundConversationWriterAppend, BoundConversationWriterBinding, BoundConversationWriterClock, BoundConversationWriterLeaseFence, BoundConversationWriterRateLimiter, BoundConversationWriterVisibilityPolicy, ComputerConversationEntryDraft } from "./bound-conversation-writer.types";

const _UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const _CONVERSATION_ENTRY_EVENT_TYPE = "opencrane.conversation-entry.v1";

/**
 * Appends one computer-authored entry through the exact stream and lease binding it was minted for.
 *
 * The writer, not the computer process, stamps trusted identity, run, stream, position, time, and
 * idempotency coordinates. It holds no history read capability and cannot switch the target stream.
 * A retry after an uncertain append reuses the original stamped bytes, while a second distinct entry
 * is refused.
 *
 * @see https://github.com/kurrent-io/KurrentDB-Client-NodeJS/tree/v1.3.1 — the client API behind the checked append.
 */
export class BoundConversationWriter
{
	/** Prevents a concurrent call from constructing a competing first entry. */
	private appendInFlight = false;
	/** Marks a successful physical append so the writer cannot accept a distinct second entry. */
	private appended = false;
	/** Retains the exact first entry for a retry after the append response was lost. */
	private retryEntry: ConversationEntry | null = null;
	/** Retains the matching command identifier required for that retry. */
	private retrySourceCommandId: string | null = null;

	/**
	 * Connects the writer to its checked append and boundary dependencies.
	 *
	 * The caller supplies narrow ports instead of a general database client so this boundary cannot
	 * read history, create bindings, or decide lease and visibility authority itself.
	 */
	public constructor(private readonly historyStore: Pick<HistoryStore, "append">, private readonly binding: BoundConversationWriterBinding, private readonly clock: BoundConversationWriterClock, private readonly rateLimiter: BoundConversationWriterRateLimiter, private readonly visibilityPolicy: BoundConversationWriterVisibilityPolicy, private readonly leaseFence: BoundConversationWriterLeaseFence) {}

	/**
	 * Stamps and appends one agent-authored entry at the binding's expected stream revision.
	 *
	 * The first call checks rate and visibility budgets, then records the stamped entry before the
	 * lease fence and checked append. If KurrentDB accepts the append but its response is lost, the
	 * same command identifier retries the saved entry without rereading the clock or accepting new
	 * computer-provided fields.
	 * @param command - Supplies the UUID source command and safe entry fields.
	 * @returns The server-stamped participant-visible entry.
	 * @throws {Error} Rejects a reused writer, invalid identifier, stale lease, invalid entry, or failed append.
	 */
	public async append(command: BoundConversationWriterAppend): Promise<ConversationEntry>
	{
		if (this.appended || this.appendInFlight)
			throw new Error("Bound conversation writer is single-use");
		if (!_UUID_PATTERN.test(command.sourceCommandId))
			throw new Error("Bound conversation writer requires a UUID source command identifier");
		if (this.retrySourceCommandId !== null && this.retrySourceCommandId !== command.sourceCommandId)
			throw new Error("Bound conversation writer retries require the original source command identifier");
		this.appendInFlight = true;
		try
		{
			const entry = this.retryEntry ?? await this._createEntry(command);
			await this.leaseFence.assertMayAppend(this.binding);
			await this.historyStore.append({ streamName: `conversation-${this.binding.conversationId}`, expectedRevision: this.binding.expectedRevision, events: [{ id: command.sourceCommandId, type: _CONVERSATION_ENTRY_EVENT_TYPE, data: { entry }, metadata: { siloId: this.binding.siloId, conversationId: this.binding.conversationId, computerId: this.binding.computerId, leaseGeneration: this.binding.leaseGeneration, agentIdentityId: this.binding.agentIdentityId, runId: this.binding.runId, causationId: entry.causationId, correlationId: entry.correlationId, idempotencyKey: entry.idempotencyKey } }] });
			this.appended = true;
			return entry;
		}
		finally
		{
			this.appendInFlight = false;
		}
	}

	/**
	 * Checks the initial request and saves the first stamped entry for a possible response-lost retry.
	 *
	 * Rate and visibility checks run before the byte limit and structural parser so a rejected draft
	 * never reaches KurrentDB.
	 */
	private async _createEntry(command: BoundConversationWriterAppend): Promise<ConversationEntry>
	{
		await this.rateLimiter.assertMayAppend(this.binding);
		await this.visibilityPolicy.assertMayUseVisibility(this.binding, command.entry.visibility);
		const entry = this._stampEntry(command.sourceCommandId, command.entry);
		const serialized = JSON.stringify(entry);
		if (new TextEncoder().encode(serialized).byteLength > this.binding.maximumEntryBytes)
			throw new Error("Bound conversation writer entry exceeds its maximum byte size");
		const result = ___ConversationComputerEntrySchema.safeParse(entry);
		if (!result.success)
			throw new Error("Bound conversation writer constructed an invalid computer entry");
		this.retryEntry = entry;
		this.retrySourceCommandId = command.sourceCommandId;
		return entry;
	}

	/**
	 * Stamps coordinates that a computer process must not choose for itself.
	 *
	 * The position derives from the checked stream revision, and the time is read once so an uncertain
	 * retry produces byte-stable event data.
	 */
	private _stampEntry(sourceCommandId: string, draft: ComputerConversationEntryDraft): ConversationEntry
	{
		const position = (this.binding.expectedRevision + 1n).toString();
		return { ...draft, schemaVersion: 1, id: sourceCommandId, conversationId: this.binding.conversationId, position, author: { kind: "agent", agentIdentityId: this.binding.agentIdentityId, agentServiceId: this.binding.agentServiceId, name: this.binding.agentName, avatarArtifactRevisionId: this.binding.agentAvatarArtifactRevisionId }, provenance: "agent-authored", visibility: draft.visibility as ConversationEntry["visibility"], runId: this.binding.runId, causationId: draft.causationId, correlationId: draft.correlationId, idempotencyKey: sourceCommandId, occurredAt: this.clock.now().toISOString(), attestation: null } as ConversationEntry;
	}
}
